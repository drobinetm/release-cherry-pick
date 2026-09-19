## Purpose

Generar documentación automática AGENTS.md y RPD.md como parte del proceso de release.

## ADDED Requirements

### Requirement: AGENTS.md generation
The system SHALL generate an AGENTS.md file documenting the project structure and conventions.

#### Scenario: Generate AGENTS.md
- **WHEN** release process completes successfully
- **THEN** the system SHALL create AGENTS.md with project overview, architecture, and conventions

#### Scenario: Include code conventions
- **WHEN** generating AGENTS.md
- **THEN** the system SHALL document coding standards, file structure, and naming conventions

### Requirement: RPD.md generation
The system SHALL generate an RPD.md (Release Process Document) file.

#### Scenario: Generate RPD.md
- **WHEN** release process completes
- **THEN** the system SHALL create RPD.md documenting the release process, steps taken, and results

#### Scenario: Include release details
- **WHEN** generating RPD.md
- **THEN** the system SHALL include branch names, commit hashes, and MR links

### Requirement: Documentation placement
The system SHALL place generated documentation in the correct location.

#### Scenario: Save to project root
- **WHEN** generating documentation files
- **THEN** the system SHALL save AGENTS.md and RPD.md in the project root directory

#### Scenario: Overwrite existing files
- **WHEN** documentation files already exist
- **THEN** the system SHALL ask user whether to overwrite or skip