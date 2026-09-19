# release-cherry-pick

CLI tool for automating release cherry-pick and GitLab MR creation.

## Installation

```bash
npm install
```

## Usage

### Start Release Process

```bash
# Interactive mode - select branches from repository
node src/index.js release

# From file - use a branch list file
node src/index.js release --file branches.txt

# Direct - specify branches
node src/index.js release --branches feature/pb-i3217,feature/pb-i3218
```

### Configuration

```bash
# Initialize configuration
node src/index.js config --init

# Show current configuration
node src/index.js config --show
```

### Branch List File Format

Create a text file with branches in this format:

```
*PB-I3217*: Al gestionar autos de una póliza y al renovar una póliza de auto, el campo Endoso no está listando los posibles valores a seleccionar.
*PB-I3218*: Error al listar "Coberturas afectadas" (Configuraciones / Reclamos / Coberturas afectadas).
*PB-I3219*: Al listar "Coberturas afectadas" y aplicar filtro según el ramo asociado.
```

## Features

- Interactive branch selection
- Branch list file parsing
- Automated cherry-pick with conflict detection
- GitLab MR creation with task ID format
- Release summary generation
- AGENTS.md and RPD.md documentation generation

## Configuration File

The tool creates a `.release-cherry-pick.json` file in your project root:

```json
{
  "git": {
    "stagingBranch": "staging",
    "branchPrefix": {
      "feature": "feature/",
      "hotfix": "hotfix/",
      "release": "release/"
    }
  },
  "gitlab": {
    "url": "https://gitlab.example.com",
    "token": "your-gitlab-token",
    "projectId": "your-project-id"
  },
  "ai": {
    "enabled": false,
    "provider": "openai",
    "apiKey": ""
  }
}
```

## Developers

- lleraabi@gmail.com
- ariel@ingeniuscuba.com
- drobinetm@outlook.com

## License

ISC
