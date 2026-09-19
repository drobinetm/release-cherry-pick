## Why

El proyecto actual necesita una herramienta CLI en Node.js que automatice el proceso de release mediante cherry-pick de ramas feature/hotfix hacia ramas de release, y la creación de Merge Requests en GitLab. Este proceso es manual, propenso a errores y consume tiempo significativo del equipo de desarrollo. La herramienta permitirá estandarizar el proceso, reducir errores humanos y agilizar los releases.

## What Changes

- Crear una CLI en Node.js que se ejecute como herramienta externa en proyectos existentes
- Implementar gestión de configuración persistente (ramas, proveedores Git, integración IA)
- Soporte para listas de ramas predefinidas o selección interactiva desde el repositorio
- Automatización del flujo: cherry-pick → detección de conflictos → creación de MR en GitLab
- Generación de reportes de resumen con estado del release (PROCEDE/NO PROCEDE)
- Creación de documentación AGENTS.md y RPD.md

## Capabilities

### New Capabilities

- `cli-core`: Estructura base de la CLI con manejo de argumentos, configuración yLogging
- `config-management`: Gestión de configuraciones persistentes (ramas, proveedores Git, opciones IA)
- `branch-selection`: Selección de ramas mediante lista predefinida o interacción con el repositorio
- `cherry-pick-orchestration`: Orquestación del proceso de cherry-pick con manejo de conflictos
- `gitlab-integration`: Integración con GitLab API para creación de Merge Requests
- `release-summary`: Generación de reportes de resumen del proceso de release
- `documentation-generation`: Generación automática de AGENTS.md y RPD.md

### Modified Capabilities

<!-- No hay capacidades existentes a modificar - este es un proyecto nuevo -->

## Impact

- **Código**: Nuevo proyecto Node.js completo con estructura modular
- **Dependencias**: 
  - Node.js runtime
  - Librería para interacción CLI (inquirer.js o similar)
  - Cliente GitLab API (axios + gitlab API o librería dedicada)
  - Manejo de procesos child para git commands
- **Sistemas**: Requiere acceso a GitLab API con permisos para crear MRs
- **Documentación**: Genera AGENTS.md y RPD.md como parte del proceso