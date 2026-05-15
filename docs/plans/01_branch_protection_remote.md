# Plan: Estrategia de ramas + remote GitHub

**Estado:** Localmente listo (`main`, `dev`, `feature/avatar-talkinghead` apuntan al mismo commit, working tree limpio). Pendiente cuando se agregue remote.

## Estado actual local

```
* dev                        ← rama default de trabajo (activa)
  feature/avatar-talkinghead ← rama historica donde vivio el trabajo previo
  feature/elevenlabs-tts     ← legacy, sin nuevos cambios
  main                       ← lo que se va a deployar (== dev por ahora)
  master                     ← muy antigua, se conserva por historico
```

Sin remote configurado todavia (`git remote -v` vacio).

## Paso 1 — Crear repo en GitHub y conectar

1. Crear repo en GitHub: `menteviva` (privado para piloto).
2. **NO marcar** "Initialize this repository with README/license/.gitignore" (ya tenemos todo).
3. Copiar la URL HTTPS o SSH.
4. Configurar el remote y subir las ramas activas (NO subir master/legacy):

```bash
cd "C:/Users/pcdec/OneDrive/Documentos/Mente Viva"

# Asociar origin
git remote add origin git@github.com:<org>/menteviva.git

# Push de las ramas relevantes
git push -u origin main
git push -u origin dev

# (Opcional) feature branches viejas, si quieres preservar historia:
# git push origin feature/avatar-talkinghead feature/elevenlabs-tts
```

> Validar **antes del push** que ningun archivo nuevo trae secretos. El initial commit `c077aa8` tenia una Groq key hardcoded; ya fue revocada en Groq Console. Si quieres eliminarla del historial antes de hacerlo publico, ver §"Opcional: scrub historia" abajo.

## Paso 2 — Configurar branch protection en GitHub

GitHub Settings → **Branches** → Add classic branch protection rule:

### Regla para `main`

- **Branch name pattern**: `main`
- ✅ Require a pull request before merging
  - ✅ Require approvals: **1** (o 2 si hay >1 reviewer en el equipo)
  - ✅ Dismiss stale pull request approvals when new commits are pushed
- ✅ Require status checks to pass before merging
  - Agregar el check de CI cuando exista (ver §"Opcional: CI" abajo).
- ✅ Require conversation resolution before merging
- ✅ Do not allow bypassing the above settings (incluye admins)
- ❌ Allow force pushes (DESHABILITADO)
- ❌ Allow deletions (DESHABILITADO)

### Default branch

Settings → **General** → Default branch = `dev` (asi los PRs apuntan ahi por default y `main` queda como destino unico de deploy).

## Paso 3 — Setup local del equipo

Cada dev que clona el repo:

```bash
git clone git@github.com:<org>/menteviva.git
cd menteviva
git checkout dev   # default
```

Para trabajar en una feature:

```bash
git checkout dev
git pull
git checkout -b feature/<descripcion-corta>
# ... commits ...
git push -u origin feature/<descripcion-corta>
# Abrir PR en GitHub: feature/<...> -> dev
```

## Paso 4 — Promote dev -> main (deploy)

Cuando una version de `dev` ya paso pruebas locales:

```bash
# Mecanica 1: PR via UI de GitHub (preferida)
# - Crear PR desde dev a main
# - Review + merge (squash o merge commit, segun gusto)

# Mecanica 2: CLI (si tienes permisos de bypass como tech lead)
git checkout main
git pull
git merge --no-ff dev -m "deploy: $(date +%Y.%m.%d)"
git tag -a "v$(date +%Y.%m.%d-%H%M)" -m "deploy piloto"
git push origin main --tags
```

Luego en el server (ver `DEPLOY_PILOTO.md` §8):

```bash
ssh menteviva@<server>
cd /opt/menteviva && git pull origin main && ./deploy.sh
```

## Opcional: scrub historia (eliminar la Groq key del initial commit)

La key `gsk_sc1KsJ4r...` esta en `c077aa8` y **fue revocada** en Groq Console, asi que no es exploitable. Si quieres dejar la historia 100% limpia antes del push:

```bash
pip install git-filter-repo
cd "C:/Users/pcdec/OneDrive/Documentos/Mente Viva"

# Crear archivo con replacements
cat > /tmp/secrets.txt <<'EOF'
REDACTED_GROQ_KEY==>REDACTED
EOF

git filter-repo --replace-text /tmp/secrets.txt
# Filter-repo reescribe TODOS los commits (cambian los SHAs).
# Solo es seguro porque NO hay remote todavia. Despues de filter-repo:
git remote add origin git@github.com:<org>/menteviva.git
git push -u origin --all --force-with-lease
git push -u origin --tags
```

> Si ya hay remote y push, **no usar filter-repo** sin avisar a todos los devs (todos tendrian que volver a clonar). Como aun no hay remote, es seguro.

## Opcional: CI mínimo en GitHub Actions

`.github/workflows/ci.yml` (sugerido):

```yaml
name: CI
on:
  pull_request:
    branches: [dev, main]
jobs:
  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: cd menteviva-frontend && npm ci && npx tsc --noEmit && npm run build
  backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.11' }
      - run: pip install poetry && cd menteviva-backend && poetry install
      - run: cd menteviva-backend && poetry run python -c "from app.main import app; print(app)"
```

Esto bloquea PRs que rompen el typecheck o el import del backend.

## Hotfix urgente en `main` (procedimiento)

```bash
git checkout main && git pull
git checkout -b hotfix/<descripcion>
# arreglar
git commit -m "hotfix: ..."
git push -u origin hotfix/<descripcion>
# Abrir PR hotfix -> main, merge tras review minimo
# Cherry-pick a dev para que no se pierda
git checkout dev && git pull && git cherry-pick <sha-del-hotfix> && git push
```

## Checklist de migracion local -> remote

- [ ] Key Groq `gsk_sc1KsJ4r...` revocada (confirmado).
- [ ] Decidir si scrub historia con `git filter-repo` (opcional).
- [ ] Crear repo en GitHub.
- [ ] `git remote add origin ...`
- [ ] `git push -u origin main`
- [ ] `git push -u origin dev`
- [ ] Settings -> Branches -> protection rule para `main`.
- [ ] Settings -> General -> Default branch = `dev`.
- [ ] (Opcional) Agregar `.github/workflows/ci.yml` y mergear a `dev`.
