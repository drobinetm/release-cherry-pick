## Context

El proyecto es una CLI Node.js que se ejecuta como herramienta externa en otros proyectos para automatizar el proceso de release mediante cherry-pick y creación de Merge Requests en GitLab. Actualmente no existe código base - el proyecto se construirá desde cero.

## Goals / Non-Goals

**Goals:**
- Crear una CLI modular y extensible con arquitectura clara
- Implementar todas las capacidades definidas en los specs
- Mantener el proyecto simple y fácil de mantener
- Proporcionar una experiencia de usuario fluida mediante interacción CLI

**Non-Goals:**
- No implementar interfaz gráfica (solo CLI)
- No soportar otros proveedores de control de versiones (solo Git/GitLab)
- No implementar autenticación OAuth (solo tokens personales)
- No crear un servicio web o API

## Decisions

### Decision 1: Arquitectura modular con separación de responsabilidades

**Choice**: Estructura de carpetas por dominio (cli-core, config, cherry-pick, gitlab, etc.)

**Rationale**: 
- Facilita testing y mantenimiento
- Permite desarrollar y probar módulos independientemente
- Sigue principios de SOLID y Clean Architecture

**Alternatives considered**:
- Estructura plana: Rechazada por dificultad de mantenimiento a medida que crece el proyecto
- Arquitectura hexagonal: Demasiado compleja para una CLI de este tamaño

### Decision 2: Framework CLI - Commander.js

**Choice**: Commander.js para parsing de argumentos

**Rationale**:
- Ampliamente usado y probado
- Soporte nativo para subcomandos
- Buena documentación y comunidad
- Ligero y sin dependencias innecesarias

**Alternatives considered**:
- Yargs: Más complejo, mejor para CLIs con muchas opciones
- Inquirer.js: Solo para prompts interactivos, no para parsing principal
- Meow: Más minimalista, menos features

### Decision 3: Interacción CLI - Inquirer.js

**Choice**: Inquirer.js para prompts interactivos

**Rationale**:
- Mejor experiencia de usuario para selección de ramas
- Soporte para listas, confirmaciones, inputs
- Fácil de usar y personalizar

**Alternatives considered**:
- Prompt: Más básico
- Readline: Nativo de Node pero más工作 intensivo

### Decision 4: Cliente GitLab - Axios + GitLab API

**Choice**: Axios para llamadas HTTP a GitLab API

**Rationale**:
- Control total sobre las llamadas API
- Fácil de implementar y testear
- Sin dependencias adicionales innecesarias

**Alternatives considered**:
- gitlab-api npm package: Menos control, dependencia adicional
- Octokit: Más para GitHub, no GitLab

### Decision 5: Ejecución de comandos Git - simple-git

**Choice**: simple-git para ejecutar comandos Git

**Rationale**:
- API simple y consistente
- Manejo de errores integrado
- Evita usar child_process directamente (más seguro)

**Alternatives considered**:
- isomorphic-git: Más complejo, mejor para apps web
- child_process: Más trabajo, propenso a errores

### Decision 6: Estructura de configuración

**Choice**: Archivo JSON `.release-cherry-pick.json` en raíz del proyecto

**Rationale**:
- Simple y nativo de Node.js
- Fácil de leer y modificar manualmente
- No requiere dependencias adicionales

**Alternatives considered**:
- YAML: Más legible pero requiere librería adicional
- dotenv: Solo para variables de entorno, no estructurado

## Risks / Trade-offs

**Risk: GitLab API rate limiting**
→ Mitigation: Implementar reintentos con backoff exponencial y caché de resultados

**Risk: Conflictos de cherry-pick no resolubles automáticamente**
→ Mitigation: Marcar como NO PROCEDE y proporcionar instrucciones claras al usuario

**Risk: Tokens de GitLab expuestos en logs**
→ Mitigation: Nunca loggear tokens, usar variables de entorno cuando sea posible

**Risk: Cambios en GitLab API**
→ Mitigation: Usar versionado de API y documentar endpoints usados

**Trade-off: Simplicidad vs Flexibilidad**
→ Decisión: Priorizar simplicidad para el caso de uso principal, permitir extensibilidad básica

## Migration Plan

No aplica - proyecto nuevo desde cero.

## Open Questions

1. ¿Se debe soportar múltiples proyectos GitLab simultáneamente?
2. ¿Qué nivel de logging se necesita (verbose, debug, quiet)?
3. ¿Se debe implementar modo dry-run para pruebas?