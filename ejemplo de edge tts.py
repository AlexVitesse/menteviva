from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import speech_recognition as sr
import edge_tts
import asyncio
import io
import tempfile
import os
from pydantic import BaseModel
from typing import Optional, List
import base64
import subprocess
import shutil
import logging
import uuid
from datetime import datetime

# LangChain imports
from langchain_community.document_loaders import PyPDFLoader, TextLoader, UnstructuredWordDocumentLoader
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_chroma import Chroma
from langchain_community.retrievers import BM25Retriever
from langchain.retrievers import EnsembleRetriever
from langchain_core.prompts import PromptTemplate
from langchain.chains import RetrievalQA
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_groq import ChatGroq
from langchain.schema import Document

# Configurar logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Papalote Museo API - Ojitos Assistant", version="2.0.0")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuración global
GROQ_API_KEY = "REDACTED_GROQ_KEY"
PDF_PATH = "papalote_knowledge_base.pdf"  # Ruta a tu PDF inicial
CHROMA_PERSIST_DIRECTORY = "./chroma_db"  # Directorio donde se guardará Chroma
UPLOADS_DIRECTORY = "./uploads"  # Directorio para archivos subidos

# Crear directorios si no existen
os.makedirs(CHROMA_PERSIST_DIRECTORY, exist_ok=True)
os.makedirs(UPLOADS_DIRECTORY, exist_ok=True)

# Verificar si FFmpeg está disponible
FFMPEG_AVAILABLE = shutil.which("ffmpeg") is not None

# Modelos Pydantic
class AudioResponse(BaseModel):
    transcription: str
    response: str
    audio_generated: bool

class TextQuery(BaseModel):
    text: str

class DocumentInfo(BaseModel):
    id: str
    filename: str
    source: str
    uploaded_at: str
    chunk_count: int

class UploadResponse(BaseModel):
    message: str
    document_id: str
    filename: str
    chunks_added: int
    total_documents: int

# Prompt del asistente Ojitos
OJITOS_PROMPT = """
Eres **"Ojitos"**, el asistente virtual experto del Papalote Museo del Niño. Eres amable, entusiasta, paciente y apasionado por el aprendizaje a través del juego. Tu propósito es ayudar a los visitantes (niños, padres, maestros) a obtener la mejor experiencia posible del museo utilizando **exclusivamente la información proporcionada en la base de conocimiento**. Recuerda siempre el lema del museo: **"Toco, juego y aprendo"**.

**TONO Y ESTILO:**
* **Lenguaje:** Claro, accesible y divertido. Evita lenguaje demasiado técnico o académico.
* **Público:** Principalmente niños y familias. Adapta tus respuestas para ser entendido por un niño de 8 años, pero sin sonar condescendiente para los adultos.
* **Actitud:** Siempre positivo, energético y servicial. Fomenta la curiosidad.
* **Formato:** Utiliza emojis con moderación (😊, 🚀, 🧠, 🔍) para darle vida a las respuestas.

**REGLAS ESTRICTAS:**
* **NO** inventes información. Si la respuesta no se encuentra en el contexto proporcionado, **DEBES** decir claramente: "Lo siento, no tengo información sobre eso en mi base de datos actual. Te recomiendo contactar al museo directamente para ayudarte mejor."
* **NO** des horarios, precios o detalles de eventos que no estén explícitamente en el contexto.
* **NUNCA** sugieras que eres un humano. Eres el asistente virtual de Papalote.
* **Mantén las respuestas concisas y directas.**

**ESTRUCTURA DE RESPUESTA:**
1. Saludo breve y entusiasta
2. Respuesta clara basada en el contexto
3. Invitación a preguntar más si es relevante

Contexto del museo:
{context}

Pregunta del usuario: {question}

Respuesta de Ojitos:
"""

class PapaloteAssistant:
    def __init__(self):
        self.vectorstore = None
        self.bm25_retriever = None
        self.ensemble_retriever = None
        self.qa_chain = None
        self.groq_llm = None
        self.recognizer = sr.Recognizer()
        self.embeddings = None
        self.text_splitter = None
        self.all_documents = []  # Lista de todos los documentos para BM25
        
    async def initialize(self):
        """Inicializa el sistema de conocimiento y el modelo"""
        try:
            # Verificar API keys
            if not GROQ_API_KEY:
                raise ValueError("GROQ_API_KEY no encontrada en variables de entorno")
            
            # Verificar FFmpeg
            if not FFMPEG_AVAILABLE:
                logger.warning("FFmpeg no encontrado. Solo se admitirán archivos WAV directamente.")
            else:
                logger.info("FFmpeg disponible para conversión de audio.")
            
            # Inicializar Groq
            self.groq_llm = ChatGroq(
                groq_api_key=GROQ_API_KEY,
                model_name="openai/gpt-oss-120b",  # Modelo más estable
                temperature=0.3
            )
            
            # Inicializar embeddings
            logger.info("Cargando modelo de embeddings...")
            self.embeddings = HuggingFaceEmbeddings(
                model_name="sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
                model_kwargs={'device': 'cpu'},
                encode_kwargs={'normalize_embeddings': True}
            )
            
            # Inicializar text splitter
            self.text_splitter = RecursiveCharacterTextSplitter(
                chunk_size=1000,
                chunk_overlap=200,
                separators=["\n\n", "\n", ".", "!", "?", ",", " ", ""]
            )
            
            # Cargar o crear vectorstore con Chroma
            await self._initialize_chroma()
            
            logger.info("Sistema inicializado correctamente")
            
        except Exception as e:
            logger.error(f"Error al inicializar el sistema: {e}")
            raise
    
    async def _initialize_chroma(self):
        """Inicializa Chroma vectorstore"""
        try:
            # Crear o cargar Chroma vectorstore
            self.vectorstore = Chroma(
                persist_directory=CHROMA_PERSIST_DIRECTORY,
                embedding_function=self.embeddings,
                collection_name="papalote_knowledge"
            )
            
            # Verificar si ya hay documentos en Chroma
            existing_count = len(self.vectorstore.get()['documents'])
            logger.info(f"Documentos existentes en Chroma: {existing_count}")
            
            # Si no hay documentos, cargar el PDF inicial
            if existing_count == 0:
                await self._load_initial_knowledge()
            
            # Actualizar retrievers
            await self._update_retrievers()
            
        except Exception as e:
            logger.error(f"Error inicializando Chroma: {e}")
            raise
    
    async def _load_initial_knowledge(self):
        """Carga el PDF inicial si existe"""
        try:
            if os.path.exists(PDF_PATH):
                logger.info(f"Cargando PDF inicial: {PDF_PATH}")
                await self._add_document_to_knowledge(PDF_PATH, "initial_pdf")
            else:
                logger.info("No se encontró PDF inicial, creando documentos de ejemplo")
                # Crear documentos de ejemplo
                example_docs = [
                    Document(
                        page_content="Papalote Museo del Niño es un lugar increíble para aprender jugando. Toco, juego y aprendo.", 
                        metadata={
                            "source": "demo",
                            "document_id": "demo_1",
                            "uploaded_at": datetime.now().isoformat(),
                            "filename": "demo_content"
                        }
                    ),
                    Document(
                        page_content="La sala Soy está dedicada a que te conozcas a ti mismo. Puedes explorar tu cuerpo y emociones.", 
                        metadata={
                            "source": "demo",
                            "document_id": "demo_2", 
                            "uploaded_at": datetime.now().isoformat(),
                            "filename": "demo_content"
                        }
                    )
                ]
                
                # Agregar a Chroma
                self.vectorstore.add_documents(example_docs)
                
        except Exception as e:
            logger.error(f"Error cargando conocimiento inicial: {e}")
    
    async def _add_document_to_knowledge(self, file_path: str, source: str, filename: str = None) -> tuple[str, int]:
        """Agrega un documento a la base de conocimiento"""
        try:
            document_id = str(uuid.uuid4())
            current_time = datetime.now().isoformat()
            
            if filename is None:
                filename = os.path.basename(file_path)
            
            # Cargar documento según su extensión
            file_extension = os.path.splitext(file_path)[1].lower()
            
            if file_extension == '.pdf':
                loader = PyPDFLoader(file_path)
            elif file_extension == '.txt':
                loader = TextLoader(file_path, encoding='utf-8')
            elif file_extension in ['.docx', '.doc']:
                loader = UnstructuredWordDocumentLoader(file_path)
            else:
                raise ValueError(f"Formato de archivo no soportado: {file_extension}")
            
            # Cargar documentos
            documents = await asyncio.to_thread(loader.load)
            
            # Dividir en chunks
            chunks = self.text_splitter.split_documents(documents)
            
            # Agregar metadata a cada chunk
            for chunk in chunks:
                chunk.metadata.update({
                    "document_id": document_id,
                    "source": source,
                    "uploaded_at": current_time,
                    "filename": filename
                })
            
            # Agregar a Chroma
            await asyncio.to_thread(self.vectorstore.add_documents, chunks)
            
            # Actualizar retrievers
            await self._update_retrievers()
            
            logger.info(f"Documento agregado: {filename}, chunks: {len(chunks)}")
            return document_id, len(chunks)
            
        except Exception as e:
            logger.error(f"Error agregando documento: {e}")
            raise
    
    async def _update_retrievers(self):
        """Actualiza los retrievers después de cambios en la base de conocimiento"""
        try:
            # Obtener todos los documentos de Chroma para BM25
            chroma_data = self.vectorstore.get()
            
            # Crear documentos para BM25
            self.all_documents = []
            for i, (doc_id, content, metadata) in enumerate(zip(
                chroma_data['ids'], 
                chroma_data['documents'], 
                chroma_data['metadatas']
            )):
                doc = Document(
                    page_content=content,
                    metadata=metadata or {}
                )
                self.all_documents.append(doc)
            
            # Crear BM25 retriever
            if self.all_documents:
                self.bm25_retriever = BM25Retriever.from_documents(self.all_documents)
                self.bm25_retriever.k = 3
                
                # Crear retriever vectorial
                vector_retriever = self.vectorstore.as_retriever(search_kwargs={"k": 3})
                
                # Combinar ambos retrievers
                self.ensemble_retriever = EnsembleRetriever(
                    retrievers=[self.bm25_retriever, vector_retriever],
                    weights=[0.4, 0.6],  # BM25: 40%, Vector: 60%
                )
                
                # Crear template de prompt
                prompt_template = PromptTemplate(
                    input_variables=["context", "question"],
                    template=OJITOS_PROMPT
                )
                
                # Crear cadena QA
                self.qa_chain = RetrievalQA.from_chain_type(
                    llm=self.groq_llm,
                    chain_type="stuff",
                    retriever=self.ensemble_retriever,
                    chain_type_kwargs={"prompt": prompt_template},
                    return_source_documents=True
                )
                
                logger.info(f"Retrievers actualizados con {len(self.all_documents)} documentos")
            
        except Exception as e:
            logger.error(f"Error actualizando retrievers: {e}")
            raise

    def _convert_audio_with_ffmpeg(self, input_path: str, output_path: str) -> bool:
        """Convierte audio usando FFmpeg"""
        try:
            cmd = [
                "ffmpeg", 
                "-i", input_path,
                "-ar", "16000",  # Sample rate 16kHz
                "-ac", "1",      # Mono
                "-acodec", "pcm_s16le",  # PCM 16-bit
                "-f", "wav",     # Formato WAV
                "-y",            # Sobrescribir archivo existente
                output_path
            ]
            
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            
            if result.returncode == 0:
                logger.info("Conversión de audio exitosa con FFmpeg")
                return True
            else:
                logger.error(f"Error en FFmpeg: {result.stderr}")
                return False
                
        except subprocess.TimeoutExpired:
            logger.error("Timeout en conversión de FFmpeg")
            return False
        except Exception as e:
            logger.error(f"Error ejecutando FFmpeg: {e}")
            return False

    async def _detect_audio_format(self, file_path: str) -> str:
        """Detecta el formato de audio del archivo"""
        try:
            if not FFMPEG_AVAILABLE:
                return "unknown"
            
            cmd = ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", file_path]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
            
            if result.returncode == 0:
                import json
                data = json.loads(result.stdout)
                format_name = data.get("format", {}).get("format_name", "unknown")
                logger.info(f"Formato de audio detectado: {format_name}")
                return format_name
            else:
                return "unknown"
                
        except Exception as e:
            logger.error(f"Error detectando formato de audio: {e}")
            return "unknown"
    
    async def transcribe_audio(self, audio_file: UploadFile) -> str:
        """Transcribe audio a texto con soporte para múltiples formatos"""
        input_file = None
        converted_file = None
        
        try:
            # Crear archivo temporal para el audio original
            with tempfile.NamedTemporaryFile(delete=False, suffix=f"_{audio_file.filename}") as tmp_file:
                content = await audio_file.read()
                tmp_file.write(content)
                input_file = tmp_file.name

            logger.info(f"Archivo recibido: {audio_file.filename}, tamaño: {len(content)} bytes")

            # Detectar formato de audio
            audio_format = await self._detect_audio_format(input_file)
            logger.info(f"Formato detectado: {audio_format}")

            # Determinar si necesita conversión
            needs_conversion = True
            if audio_format in ["wav", "aiff", "flac"]:
                # Intentar usar directamente primero
                try:
                    with sr.AudioFile(input_file) as source:
                        audio = self.recognizer.record(source)
                        text = self.recognizer.recognize_google(audio, language="es-ES")
                        logger.info("Transcripción exitosa sin conversión")
                        return text
                except Exception as direct_error:
                    logger.warning(f"Fallo directo, intentando conversión: {direct_error}")
                    needs_conversion = True

            # Si necesita conversión y FFmpeg está disponible
            if needs_conversion and FFMPEG_AVAILABLE:
                logger.info("Convirtiendo audio a formato WAV...")
                
                # Crear archivo temporal para la conversión
                converted_file = tempfile.mktemp(suffix=".wav")
                
                if self._convert_audio_with_ffmpeg(input_file, converted_file):
                    # Usar archivo convertido
                    with sr.AudioFile(converted_file) as source:
                        # Ajustar ruido ambiente
                        self.recognizer.adjust_for_ambient_noise(source, duration=0.5)
                        audio = self.recognizer.record(source)
                        text = self.recognizer.recognize_google(audio, language="es-ES")
                        logger.info("Transcripción exitosa con conversión FFmpeg")
                        return text
                else:
                    raise HTTPException(status_code=400, detail="No se pudo convertir el archivo de audio")
            
            elif needs_conversion and not FFMPEG_AVAILABLE:
                raise HTTPException(
                    status_code=400, 
                    detail=f"Formato de audio '{audio_format}' no compatible. Use archivos WAV, AIFF o FLAC, o instale FFmpeg para soporte de más formatos."
                )
            
            # Si llegamos aquí, algo salió mal
            raise HTTPException(status_code=400, detail="No se pudo procesar el archivo de audio")
            
        except sr.UnknownValueError:
            raise HTTPException(status_code=400, detail="No se pudo entender el audio. Intente hablar más claro o acérquese al micrófono.")
        except sr.RequestError as e:
            raise HTTPException(status_code=500, detail=f"Error en el servicio de transcripción: {e}")
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error transcribiendo audio: {e}")
            raise HTTPException(status_code=500, detail=f"Error procesando el audio: {str(e)}")
        finally:
            # Limpiar archivos temporales
            for file_path in [input_file, converted_file]:
                if file_path and os.path.exists(file_path):
                    try:
                        os.unlink(file_path)
                    except Exception as e:
                        logger.warning(f"No se pudo eliminar archivo temporal {file_path}: {e}")
    
    async def get_response(self, question: str) -> str:
        """Obtiene respuesta del asistente usando Groq y el contexto híbrido (BM25 + Vector)"""
        try:
            if not self.qa_chain:
                return "Lo siento, el sistema de conocimiento no está disponible en este momento. 😔"
            
            # Usar la cadena QA que combina BM25 y búsqueda vectorial
            result = await asyncio.to_thread(
                self.qa_chain.invoke,
                {"query": question}
            )
            
            response = result["result"]
            
            # Log de documentos fuente para debugging
            if "source_documents" in result:
                logger.info(f"Documentos fuente utilizados: {len(result['source_documents'])}")
                #for i, doc in enumerate(result['source_documents'][:3]):
                    #logger.info(f"Doc {i+1}: {doc.page_content[:100]}...")
            
            return response
            
        except Exception as e:
            logger.error(f"Error obteniendo respuesta: {e}")
            return "Lo siento, tuve un problema técnico. ¿Puedes intentar preguntarme de nuevo? 😊"
    
    async def generate_audio(self, text: str) -> bytes:
        """Genera audio usando edge-tts"""
        try:
            # Configurar edge-tts con voz en español
            voice = "es-MX-JorgeNeural"  # Voz masculina mexicana
            
            communicate = edge_tts.Communicate(text, voice)
            
            # Generar audio en memoria
            audio_data = b""
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    audio_data += chunk["data"]
            
            return audio_data
            
        except Exception as e:
            logger.error(f"Error generando audio: {e}")
            raise HTTPException(status_code=500, detail="Error generando audio")
    
    async def get_documents_info(self) -> List[DocumentInfo]:
        """Obtiene información de todos los documentos en la base de conocimiento"""
        try:
            chroma_data = self.vectorstore.get()
            
            # Agrupar por document_id
            docs_info = {}
            for metadata in chroma_data['metadatas']:
                if metadata:
                    doc_id = metadata.get('document_id', 'unknown')
                    if doc_id not in docs_info:
                        docs_info[doc_id] = {
                            'id': doc_id,
                            'filename': metadata.get('filename', 'unknown'),
                            'source': metadata.get('source', 'unknown'),
                            'uploaded_at': metadata.get('uploaded_at', 'unknown'),
                            'chunk_count': 0
                        }
                    docs_info[doc_id]['chunk_count'] += 1
            
            return [DocumentInfo(**info) for info in docs_info.values()]
            
        except Exception as e:
            logger.error(f"Error obteniendo información de documentos: {e}")
            return []
    
    async def delete_document(self, document_id: str) -> bool:
        """Elimina un documento de la base de conocimiento"""
        try:
            # Obtener IDs de chunks del documento
            chroma_data = self.vectorstore.get()
            chunk_ids_to_delete = []
            
            for i, metadata in enumerate(chroma_data['metadatas']):
                if metadata and metadata.get('document_id') == document_id:
                    chunk_ids_to_delete.append(chroma_data['ids'][i])
            
            if chunk_ids_to_delete:
                # Eliminar chunks de Chroma
                self.vectorstore.delete(ids=chunk_ids_to_delete)
                
                # Actualizar retrievers
                await self._update_retrievers()
                
                logger.info(f"Documento eliminado: {document_id}, chunks: {len(chunk_ids_to_delete)}")
                return True
            else:
                return False
                
        except Exception as e:
            logger.error(f"Error eliminando documento: {e}")
            return False

# Instancia global del asistente
assistant = PapaloteAssistant()

@app.on_event("startup")
async def startup_event():
    """Inicializa el asistente al arrancar la aplicación"""
    await assistant.initialize()

@app.get("/")
async def root():
    return {"message": "¡Hola! Soy Ojitos, el asistente virtual de Papalote Museo del Niño 😊", "version": "2.0.0"}

@app.post("/ask-audio")
async def ask_with_audio(audio: UploadFile = File(...)):
    """
    Endpoint principal: recibe audio, lo transcribe, obtiene respuesta y genera audio de respuesta
    """
    try:
        # 1. Transcribir audio
        logger.info("Transcribiendo audio...")
        transcription = await assistant.transcribe_audio(audio)
        logger.info(f"Transcripción: {transcription}")
        
        # 2. Obtener respuesta del asistente
        logger.info("Generando respuesta...")
        response_text = await assistant.get_response(transcription)
        logger.info(f"Respuesta generada: {response_text[:100]}...")
        
        # 3. Generar audio de respuesta
        logger.info("Generando audio de respuesta...")
        audio_data = await assistant.generate_audio(response_text)
        
        # 4. Retornar respuesta con audio como streaming response
        # Codificar texto en base64 para los headers (preserva emojis)
        transcription_b64 = base64.b64encode(transcription.encode('utf-8')).decode('ascii')
        response_b64 = base64.b64encode(response_text.encode('utf-8')).decode('ascii')
        
        return StreamingResponse(
            io.BytesIO(audio_data),
            media_type="audio/mpeg",
            headers={
                "X-Transcription-B64": transcription_b64,
                "X-Response-Text-B64": response_b64,
                "Content-Disposition": "attachment; filename=response.mp3",
                "Access-Control-Expose-Headers": "X-Transcription-B64, X-Response-Text-B64"
            }
        )
        
    except Exception as e:
        logger.error(f"Error en ask_with_audio: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/ask-text")
async def ask_with_text(query: TextQuery):
    """
    Endpoint alternativo: solo texto, sin audio
    """
    try:
        response_text = await assistant.get_response(query.text)
        return {"question": query.text, "response": response_text}
        
    except Exception as e:
        logger.error(f"Error en ask_with_text: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/text-to-speech")
async def text_to_speech(query: TextQuery):
    """
    Convierte texto a audio
    """
    try:
        audio_data = await assistant.generate_audio(query.text)
        return StreamingResponse(
            io.BytesIO(audio_data),
            media_type="audio/mpeg",
            headers={"Content-Disposition": "attachment; filename=speech.mp3"}
        )
        
    except Exception as e:
        logger.error(f"Error en text_to_speech: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/upload-document", response_model=UploadResponse)
async def upload_document(
    file: UploadFile = File(...), 
    description: Optional[str] = Form(None)
):
    """
    Sube un documento a la base de conocimiento.
    Soporta PDF, TXT, DOC, DOCX
    """
    try:
        # Validar tipo de archivo
        allowed_extensions = {'.pdf', '.txt', '.doc', '.docx'}
        file_extension = os.path.splitext(file.filename)[1].lower()
        
        if file_extension not in allowed_extensions:
            raise HTTPException(
                status_code=400, 
                detail=f"Tipo de archivo no soportado: {file_extension}. Tipos permitidos: {', '.join(allowed_extensions)}"
            )
        
        # Crear nombre único para el archivo
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        safe_filename = f"{timestamp}_{file.filename}"
        file_path = os.path.join(UPLOADS_DIRECTORY, safe_filename)
        
        # Guardar archivo
        with open(file_path, "wb") as buffer:
            content = await file.read()
            buffer.write(content)
        
        logger.info(f"Archivo guardado: {file_path}")
        
        # Agregar a la base de conocimiento
        source = description if description else "uploaded"
        document_id, chunk_count = await assistant._add_document_to_knowledge(
            file_path, source, file.filename
        )
        
        # Obtener total de documentos
        docs_info = await assistant.get_documents_info()
        total_docs = len(docs_info)
        
        logger.info(f"Documento procesado exitosamente: {file.filename}")
        
        return UploadResponse(
            message=f"Documento '{file.filename}' subido y procesado exitosamente",
            document_id=document_id,
            filename=file.filename,
            chunks_added=chunk_count,
            total_documents=total_docs
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error subiendo documento: {e}")
        raise HTTPException(status_code=500, detail=f"Error procesando el documento: {str(e)}")

@app.get("/documents", response_model=List[DocumentInfo])
async def list_documents():
    """
    Lista todos los documentos en la base de conocimiento
    """
    try:
        return await assistant.get_documents_info()
    except Exception as e:
        logger.error(f"Error listando documentos: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/documents/{document_id}")
async def delete_document(document_id: str):
    """
    Elimina un documento de la base de conocimiento
    """
    try:
        success = await assistant.delete_document(document_id)
        
        if success:
            return {"message": f"Documento {document_id} eliminado exitosamente"}
        else:
            raise HTTPException(status_code=404, detail="Documento no encontrado")
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error eliminando documento: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/knowledge-stats")
async def get_knowledge_stats():
    """
    Obtiene estadísticas de la base de conocimiento
    """
    try:
        docs_info = await assistant.get_documents_info()
        
        # Obtener datos de Chroma
        chroma_data = assistant.vectorstore.get()
        total_chunks = len(chroma_data['documents'])
        
        # Agrupar por fuente
        sources = {}
        for metadata in chroma_data['metadatas']:
            if metadata:
                source = metadata.get('source', 'unknown')
                sources[source] = sources.get(source, 0) + 1
        
        return {
            "total_documents": len(docs_info),
            "total_chunks": total_chunks,
            "sources": sources,
            "chroma_collection": "papalote_knowledge",
            "persist_directory": CHROMA_PERSIST_DIRECTORY
        }
        
    except Exception as e:
        logger.error(f"Error obteniendo estadísticas: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/clear-knowledge")
async def clear_knowledge_base():
    """
    CUIDADO: Elimina toda la base de conocimiento.
    Solo usar para reiniciar completamente el sistema.
    """
    try:
        # Obtener todos los IDs
        chroma_data = assistant.vectorstore.get()
        all_ids = chroma_data['ids']
        
        if all_ids:
            # Eliminar todos los documentos
            assistant.vectorstore.delete(ids=all_ids)
            
            # Limpiar lista de documentos
            assistant.all_documents = []
            
            # Resetear retrievers
            assistant.bm25_retriever = None
            assistant.ensemble_retriever = None
            assistant.qa_chain = None
            
            logger.info("Base de conocimiento eliminada completamente")
            
            return {
                "message": "Base de conocimiento eliminada completamente",
                "documents_deleted": len(all_ids)
            }
        else:
            return {"message": "La base de conocimiento ya estaba vacía"}
            
    except Exception as e:
        logger.error(f"Error eliminando base de conocimiento: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/rebuild-retrievers")
async def rebuild_retrievers():
    """
    Reconstruye los retrievers (útil si hay problemas de sincronización)
    """
    try:
        await assistant._update_retrievers()
        
        docs_count = len(assistant.all_documents) if assistant.all_documents else 0
        
        return {
            "message": "Retrievers reconstruidos exitosamente",
            "documents_in_retriever": docs_count,
            "bm25_ready": assistant.bm25_retriever is not None,
            "ensemble_ready": assistant.ensemble_retriever is not None,
            "qa_chain_ready": assistant.qa_chain is not None
        }
        
    except Exception as e:
        logger.error(f"Error reconstruyendo retrievers: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
async def health_check():
    """Health check endpoint con información detallada"""
    try:
        docs_info = await assistant.get_documents_info()
        chroma_data = assistant.vectorstore.get() if assistant.vectorstore else {'documents': []}
        
        return {
            "status": "healthy",
            "version": "2.0.0",
            "groq_configured": bool(GROQ_API_KEY),
            "chroma_ready": assistant.vectorstore is not None,
            "documents_loaded": len(docs_info),
            "total_chunks": len(chroma_data['documents']),
            "bm25_ready": assistant.bm25_retriever is not None,
            "ensemble_ready": assistant.ensemble_retriever is not None,
            "qa_chain_ready": assistant.qa_chain is not None,
            "ffmpeg_available": FFMPEG_AVAILABLE,
            "persist_directory": CHROMA_PERSIST_DIRECTORY,
            "uploads_directory": UPLOADS_DIRECTORY
        }
        
    except Exception as e:
        logger.error(f"Error en health check: {e}")
        return {
            "status": "unhealthy",
            "error": str(e)
        }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)