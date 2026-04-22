import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

export type AvatarCharacter = "roberto" | "maria";

interface AnimatedAvatarProps {
  character: AvatarCharacter;
  isSpeaking?: boolean;
  isActive?: boolean;
  size?: number;
}

// Configuración mejorada de cada personaje
const CHARACTERS = {
  roberto: {
    skinColor: "#D4A574",
    skinHighlight: "#E8C9A8",
    skinShadow: "#B8896A",
    hairColor: "#3D2B1F",
    hairHighlight: "#5C4033",
    eyeColor: "#3D2914",
    eyeHighlight: "#5C4528",
    shirtColor: "#1E3A5F",
    shirtHighlight: "#2A4A6F",
    tieColor: "#8B2942",
    glassesColor: "#2C2C2C",
    lipColor: "#B88B7A",
    lipHighlight: "#C9A090",
    hasGlasses: true,
    hasBeard: true,
    beardColor: "#3D2B1F",
  },
  maria: {
    skinColor: "#E8C4A0",
    skinHighlight: "#F5DCC8",
    skinShadow: "#D4A882",
    hairColor: "#1C1008",
    hairHighlight: "#3D2B1F",
    eyeColor: "#4A3520",
    eyeHighlight: "#6B5030",
    shirtColor: "#5B3D7A",
    shirtHighlight: "#7B5D9A",
    earringColor: "#FFD700",
    lipColor: "#C45C5C",
    lipHighlight: "#D47878",
    hasGlasses: false,
    hasEarrings: true,
  },
};

export function AnimatedAvatar({
  character,
  isSpeaking = false,
  isActive = false,
  size = 280,
}: AnimatedAvatarProps) {
  const config = CHARACTERS[character];
  const [mouthShape, setMouthShape] = useState(0);
  const [isBlinking, setIsBlinking] = useState(false);
  const [eyeOffset, setEyeOffset] = useState({ x: 0, y: 0 });
  const [headTilt, setHeadTilt] = useState(0);
  const [browOffset, setBrowOffset] = useState(0);
  const speakingIntervalRef = useRef<number>(0);
  const breathingRef = useRef(0);

  // Animación de habla mejorada con formas de boca variadas
  useEffect(() => {
    if (isSpeaking) {
      const animateMouth = () => {
        // Variar entre diferentes formas de boca (0-1)
        const shape = 0.2 + Math.random() * 0.8;
        setMouthShape(shape);

        // Mover cabeza sutilmente al hablar
        setHeadTilt((Math.random() - 0.5) * 3);

        // Mover cejas ocasionalmente
        if (Math.random() > 0.7) {
          setBrowOffset(Math.random() * 2 - 1);
        }
      };

      speakingIntervalRef.current = window.setInterval(() => {
        animateMouth();
      }, 80 + Math.random() * 60);

      animateMouth();

      return () => {
        clearInterval(speakingIntervalRef.current);
        setMouthShape(0);
        setHeadTilt(0);
        setBrowOffset(0);
      };
    } else {
      setMouthShape(0);
    }
  }, [isSpeaking]);

  // Parpadeo natural
  useEffect(() => {
    const blink = () => {
      setIsBlinking(true);
      setTimeout(() => setIsBlinking(false), 120);
    };

    const scheduleNextBlink = () => {
      const delay = 2500 + Math.random() * 4000;
      return setTimeout(() => {
        blink();
        scheduleNextBlink();
      }, delay);
    };

    const timeoutId = scheduleNextBlink();
    return () => clearTimeout(timeoutId);
  }, []);

  // Movimiento de ojos más natural
  useEffect(() => {
    const moveEyes = () => {
      const x = (Math.random() - 0.5) * 6;
      const y = (Math.random() - 0.5) * 4;
      setEyeOffset({ x, y });
    };

    const interval = setInterval(moveEyes, 1500 + Math.random() * 2500);
    return () => clearInterval(interval);
  }, []);

  // Respiración sutil
  useEffect(() => {
    const breathe = () => {
      breathingRef.current = (breathingRef.current + 0.05) % (Math.PI * 2);
    };
    const interval = setInterval(breathe, 50);
    return () => clearInterval(interval);
  }, []);

  const eyeWhiteRy = isBlinking ? 1 : 14;
  const eyeIrisRy = isBlinking ? 0.5 : 10;
  const breathScale = 1 + Math.sin(breathingRef.current) * 0.003;

  return (
    <motion.div
      animate={{
        scale: isActive ? [1, 1.01, 1] : 1,
        rotate: headTilt,
      }}
      transition={{
        scale: { repeat: Infinity, duration: 4, ease: "easeInOut" },
        rotate: { duration: 0.2 }
      }}
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 200 220"
        width={size}
        height={size}
        className="drop-shadow-2xl"
      >
        <defs>
          {/* Gradientes de piel mejorados */}
          <radialGradient id={`skinGrad-${character}`} cx="40%" cy="30%" r="80%">
            <stop offset="0%" stopColor={config.skinHighlight} />
            <stop offset="50%" stopColor={config.skinColor} />
            <stop offset="100%" stopColor={config.skinShadow} />
          </radialGradient>

          {/* Gradiente para sombra facial */}
          <linearGradient id={`faceShadow-${character}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="transparent" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.15)" />
          </linearGradient>

          {/* Gradiente de camisa */}
          <linearGradient id={`shirtGrad-${character}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={config.shirtHighlight} />
            <stop offset="100%" stopColor={config.shirtColor} />
          </linearGradient>

          {/* Gradiente de cabello */}
          <linearGradient id={`hairGrad-${character}`} x1="0%" y1="0%" x2="50%" y2="100%">
            <stop offset="0%" stopColor={config.hairHighlight} />
            <stop offset="100%" stopColor={config.hairColor} />
          </linearGradient>

          {/* Brillo del cabello */}
          <linearGradient id={`hairShine-${character}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="transparent" />
            <stop offset="40%" stopColor="rgba(255,255,255,0.1)" />
            <stop offset="60%" stopColor="rgba(255,255,255,0.1)" />
            <stop offset="100%" stopColor="transparent" />
          </linearGradient>

          {/* Gradiente de ojos */}
          <radialGradient id={`eyeGrad-${character}`} cx="30%" cy="30%" r="70%">
            <stop offset="0%" stopColor={config.eyeHighlight} />
            <stop offset="100%" stopColor={config.eyeColor} />
          </radialGradient>

          {/* Sombra bajo la cara */}
          <filter id="dropShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="4" stdDeviation="3" floodColor="rgba(0,0,0,0.3)" />
          </filter>

          {/* Blur suave para sombras */}
          <filter id="softBlur">
            <feGaussianBlur stdDeviation="2" />
          </filter>

          {character === "maria" && config.lipColor && (
            <linearGradient id="lipGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={(config as typeof CHARACTERS.maria).lipHighlight} />
              <stop offset="100%" stopColor={(config as typeof CHARACTERS.maria).lipColor} />
            </linearGradient>
          )}
        </defs>

        {/* Sombra del cuerpo */}
        <ellipse
          cx="100"
          cy="210"
          rx="45"
          ry="8"
          fill="rgba(0,0,0,0.2)"
          filter="url(#softBlur)"
        />

        {/* Cuello con sombra */}
        <ellipse
          cx="100"
          cy="175"
          rx="22"
          ry="18"
          fill={config.skinShadow}
        />
        <ellipse
          cx="100"
          cy="173"
          rx="20"
          ry="16"
          fill={`url(#skinGrad-${character})`}
        />

        {/* Camisa/Ropa mejorada */}
        <path
          d={character === "roberto"
            ? "M 45 220 Q 45 180 65 168 L 100 162 L 135 168 Q 155 180 155 220 Z"
            : "M 40 220 Q 40 175 60 163 Q 80 158 100 156 Q 120 158 140 163 Q 160 175 160 220 Z"
          }
          fill={`url(#shirtGrad-${character})`}
          filter="url(#dropShadow)"
        />

        {/* Detalles de la camisa */}
        {character === "roberto" && (
          <>
            {/* Cuello de camisa */}
            <path
              d="M 80 168 L 90 162 L 100 168 L 110 162 L 120 168"
              stroke="white"
              strokeWidth="2"
              fill="none"
              opacity="0.9"
            />
            {/* Corbata mejorada */}
            <path
              d="M 96 168 L 100 162 L 104 168 L 102 200 L 100 205 L 98 200 Z"
              fill={(config as typeof CHARACTERS.roberto).tieColor}
            />
            <path
              d="M 97 168 L 100 163 L 103 168"
              fill="none"
              stroke="rgba(255,255,255,0.2)"
              strokeWidth="1"
            />
          </>
        )}

        {/* Escote para María */}
        {character === "maria" && (
          <path
            d="M 82 163 Q 100 175 118 163"
            stroke={config.skinColor}
            strokeWidth="4"
            fill="none"
          />
        )}

        {/* Cabeza - base con mejor forma */}
        <motion.g
          animate={{ scale: breathScale }}
          style={{ transformOrigin: "100px 100px" }}
        >
          {/* Sombra de la cabeza */}
          <ellipse
            cx="102"
            cy="102"
            rx="56"
            ry="66"
            fill="rgba(0,0,0,0.1)"
            filter="url(#softBlur)"
          />

          {/* Cara principal */}
          <ellipse
            cx="100"
            cy="100"
            rx="55"
            ry="65"
            fill={`url(#skinGrad-${character})`}
          />

          {/* Sombra lateral sutil */}
          <ellipse
            cx="100"
            cy="100"
            rx="55"
            ry="65"
            fill={`url(#faceShadow-${character})`}
            opacity="0.3"
          />
        </motion.g>

        {/* Orejas mejoradas */}
        <g>
          <ellipse cx="46" cy="100" rx="9" ry="14" fill={config.skinShadow} />
          <ellipse cx="45" cy="100" rx="8" ry="13" fill={config.skinColor} />
          <ellipse cx="45" cy="100" rx="4" ry="7" fill={config.skinShadow} opacity="0.3" />

          <ellipse cx="154" cy="100" rx="9" ry="14" fill={config.skinShadow} />
          <ellipse cx="155" cy="100" rx="8" ry="13" fill={config.skinColor} />
          <ellipse cx="155" cy="100" rx="4" ry="7" fill={config.skinShadow} opacity="0.3" />
        </g>

        {/* Aretes para María */}
        {character === "maria" && (config as typeof CHARACTERS.maria).hasEarrings && (
          <>
            <circle cx="45" cy="116" r="5" fill={(config as typeof CHARACTERS.maria).earringColor} />
            <circle cx="45" cy="116" r="3" fill="#FFF8DC" opacity="0.5" />
            <circle cx="155" cy="116" r="5" fill={(config as typeof CHARACTERS.maria).earringColor} />
            <circle cx="155" cy="116" r="3" fill="#FFF8DC" opacity="0.5" />
          </>
        )}

        {/* Cabello mejorado */}
        {character === "roberto" ? (
          <g>
            {/* Cabello corto estilo ejecutivo */}
            <path
              d="M 50 65 Q 50 35 100 30 Q 150 35 150 65 Q 145 50 100 45 Q 55 50 50 65"
              fill={`url(#hairGrad-${character})`}
            />
            {/* Parte superior del cabello */}
            <ellipse cx="100" cy="42" rx="45" ry="18" fill={`url(#hairGrad-${character})`} />
            {/* Brillo del cabello */}
            <path
              d="M 65 38 Q 85 32 100 32 Q 115 32 135 38"
              stroke="rgba(255,255,255,0.2)"
              strokeWidth="3"
              fill="none"
            />
          </g>
        ) : (
          <g>
            {/* Cabello largo de María */}
            <ellipse cx="100" cy="45" rx="54" ry="30" fill={`url(#hairGrad-${character})`} />
            {/* Mechones laterales */}
            <path
              d="M 46 55 Q 32 85 36 140 Q 38 158 48 165 L 50 110 Q 48 65 55 50 Z"
              fill={`url(#hairGrad-${character})`}
            />
            <path
              d="M 154 55 Q 168 85 164 140 Q 162 158 152 165 L 150 110 Q 152 65 145 50 Z"
              fill={`url(#hairGrad-${character})`}
            />
            {/* Brillo del cabello */}
            <path
              d="M 55 40 Q 80 30 100 28 Q 120 30 145 40"
              stroke="rgba(255,255,255,0.12)"
              strokeWidth="5"
              fill="none"
            />
            {/* Flequillo sutil */}
            <path
              d="M 52 50 Q 75 42 100 40 Q 125 42 148 50"
              fill={config.hairColor}
            />
          </g>
        )}

        {/* Cejas mejoradas con expresión */}
        <motion.g animate={{ y: browOffset }}>
          <path
            d={`M 63 ${73 + (isActive ? -1 : 0)} Q 76 ${68 + (isActive ? -1 : 0)} 88 ${72 + (isActive ? -1 : 0)}`}
            stroke={config.hairColor}
            strokeWidth="3.5"
            strokeLinecap="round"
            fill="none"
            opacity="0.9"
          />
          <path
            d={`M 112 ${72 + (isActive ? -1 : 0)} Q 124 ${68 + (isActive ? -1 : 0)} 137 ${73 + (isActive ? -1 : 0)}`}
            stroke={config.hairColor}
            strokeWidth="3.5"
            strokeLinecap="round"
            fill="none"
            opacity="0.9"
          />
        </motion.g>

        {/* Ojos mejorados */}
        <g transform={`translate(${eyeOffset.x}, ${eyeOffset.y})`}>
          {/* Ojo izquierdo */}
          <g>
            {/* Sombra del párpado */}
            <ellipse cx="75" cy="86" rx="16" ry="4" fill={config.skinShadow} opacity="0.4" />

            {/* Blanco del ojo */}
            <ellipse
              cx="75"
              cy="90"
              rx="15"
              ry={eyeWhiteRy}
              fill="white"
              style={{ transition: "ry 80ms" }}
            />

            {/* Iris con gradiente */}
            <ellipse
              cx="75"
              cy={isBlinking ? 90 : 91}
              rx="8"
              ry={eyeIrisRy}
              fill={`url(#eyeGrad-${character})`}
              style={{ transition: "ry 80ms" }}
            />

            {/* Pupila */}
            {!isBlinking && (
              <circle cx="75" cy="91" r="4" fill="#1a1a1a" />
            )}

            {/* Brillos del ojo */}
            {!isBlinking && (
              <>
                <circle cx="78" cy="87" r="3" fill="white" opacity="0.9" />
                <circle cx="72" cy="93" r="1.5" fill="white" opacity="0.5" />
              </>
            )}
          </g>

          {/* Ojo derecho */}
          <g>
            <ellipse cx="125" cy="86" rx="16" ry="4" fill={config.skinShadow} opacity="0.4" />

            <motion.ellipse
              cx="125"
              cy="90"
              rx="15"
              ry={eyeWhiteRy}
              fill="white"
              animate={{ ry: eyeWhiteRy }}
              transition={{ duration: 0.08 }}
            />

            <ellipse
              cx="125"
              cy={isBlinking ? 90 : 91}
              rx="8"
              ry={eyeIrisRy}
              fill={`url(#eyeGrad-${character})`}
              style={{ transition: "ry 80ms" }}
            />

            {!isBlinking && (
              <circle cx="125" cy="91" r="4" fill="#1a1a1a" />
            )}

            {!isBlinking && (
              <>
                <circle cx="128" cy="87" r="3" fill="white" opacity="0.9" />
                <circle cx="122" cy="93" r="1.5" fill="white" opacity="0.5" />
              </>
            )}
          </g>
        </g>

        {/* Gafas para Roberto mejoradas */}
        {character === "roberto" && (config as typeof CHARACTERS.roberto).hasGlasses && (
          <g>
            {/* Sombra de las gafas */}
            <rect x="57" y="79" width="36" height="30" rx="6" fill="rgba(0,0,0,0.1)" />
            <rect x="107" y="79" width="36" height="30" rx="6" fill="rgba(0,0,0,0.1)" />

            {/* Marco de las gafas */}
            <g stroke={(config as typeof CHARACTERS.roberto).glassesColor} strokeWidth="2.5" fill="none">
              <rect x="56" y="78" width="36" height="30" rx="6" />
              <rect x="108" y="78" width="36" height="30" rx="6" />
              <path d="M 92 93 L 108 93" />
              <path d="M 56 88 L 46 85" />
              <path d="M 144 88 L 154 85" />
            </g>

            {/* Reflejo en los lentes */}
            <path d="M 62 82 L 72 82" stroke="rgba(255,255,255,0.3)" strokeWidth="2" strokeLinecap="round" />
            <path d="M 114 82 L 124 82" stroke="rgba(255,255,255,0.3)" strokeWidth="2" strokeLinecap="round" />
          </g>
        )}

        {/* Nariz mejorada */}
        <g>
          <path
            d={character === "roberto"
              ? "M 100 88 L 95 110 Q 100 116 105 110 L 100 88"
              : "M 100 90 Q 95 105 97 112 Q 100 116 103 112 Q 105 105 100 90"
            }
            fill={config.skinShadow}
            opacity="0.6"
          />
          {/* Brillo de la nariz */}
          <ellipse cx="100" cy="105" rx="3" ry="2" fill={config.skinHighlight} opacity="0.4" />
        </g>

        {/* Boca mejorada */}
        <g>
          {/* María - labios siempre visibles */}
          {character === "maria" && (
            <>
              {/* Labio superior */}
              <path
                d={`M ${87 - mouthShape * 2} 130
                    Q 93 ${128 - mouthShape * 2} 100 ${127 - mouthShape * 3}
                    Q 107 ${128 - mouthShape * 2} ${113 + mouthShape * 2} 130`}
                fill={config.lipColor}
              />
              {/* Labio inferior */}
              <ellipse
                cx="100"
                cy={133 + mouthShape * 3}
                rx={12 + mouthShape * 3}
                ry={4 + mouthShape * 5}
                fill={config.lipColor}
              />
              {/* Apertura de boca (solo cuando habla) */}
              {mouthShape > 0.15 && (
                <ellipse
                  cx="100"
                  cy={131 + mouthShape * 2}
                  rx={8 + mouthShape * 5}
                  ry={mouthShape * 10}
                  fill="#3A1010"
                />
              )}
            </>
          )}

          {/* Roberto - boca más simple */}
          {character === "roberto" && (
            <>
              {/* Boca cerrada = línea sutil */}
              {mouthShape <= 0.15 && (
                <path
                  d="M 88 131 Q 100 134 112 131"
                  stroke={config.lipColor}
                  strokeWidth="2.5"
                  fill="none"
                  strokeLinecap="round"
                />
              )}
              {/* Boca abierta */}
              {mouthShape > 0.15 && (
                <ellipse
                  cx="100"
                  cy={131 + mouthShape * 2}
                  rx={10 + mouthShape * 5}
                  ry={mouthShape * 12}
                  fill="#3A1010"
                />
              )}
            </>
          )}

          {/* Dientes superiores (cuando boca abierta) */}
          {mouthShape > 0.35 && (
            <rect
              x={93 - mouthShape * 2}
              y={129}
              width={14 + mouthShape * 4}
              height={Math.min(mouthShape * 7, 5)}
              fill="white"
              rx="1"
            />
          )}

          {/* Lengua (cuando boca muy abierta) */}
          {mouthShape > 0.6 && (
            <ellipse
              cx="100"
              cy={137 + mouthShape * 4}
              rx={5 + mouthShape * 2}
              ry={2 + mouthShape * 2}
              fill="#B55555"
            />
          )}
        </g>

        {/* Barba para Roberto mejorada */}
        {character === "roberto" && (config as typeof CHARACTERS.roberto).hasBeard && (
          <g>
            {/* Sombra de barba */}
            <ellipse
              cx="100"
              cy={145 + mouthShape * 3}
              rx="32"
              ry={18 + mouthShape * 2}
              fill={(config as typeof CHARACTERS.roberto).beardColor}
              opacity="0.35"
            />
            {/* Textura de barba */}
            <ellipse
              cx="100"
              cy={143 + mouthShape * 3}
              rx="30"
              ry={16 + mouthShape * 2}
              fill={(config as typeof CHARACTERS.roberto).beardColor}
              opacity="0.25"
            />
            {/* Área limpia para la boca */}
            <ellipse
              cx="100"
              cy={130}
              rx="20"
              ry={10 + mouthShape * 6}
              fill={config.skinColor}
            />
          </g>
        )}

        {/* Mejillas con rubor */}
        <ellipse cx="62" cy="112" rx="12" ry="7" fill="#FFB6C1" opacity="0.25" />
        <ellipse cx="138" cy="112" rx="12" ry="7" fill="#FFB6C1" opacity="0.25" />

        {/* Brillo en la mejilla (highlight) */}
        <ellipse cx="68" cy="95" rx="6" ry="4" fill="white" opacity="0.08" />
        <ellipse cx="132" cy="95" rx="6" ry="4" fill="white" opacity="0.08" />
      </svg>
    </motion.div>
  );
}
