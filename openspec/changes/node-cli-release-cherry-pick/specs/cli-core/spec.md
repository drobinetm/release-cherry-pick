## Purpose

Proporcionar la estructura base de la CLI con manejo de argumentos, configuración y logging para el proceso de release cherry-pick.

## ADDED Requirements

### Requirement: CLI entry point
The system SHALL provide a CLI entry point that can be executed via `node` or as a global command after installation.

#### Scenario: Execute CLI command
- **WHEN** user runs `npx release-cherry-pick` or the installed CLI command
- **THEN** the CLI SHALL initialize and display the main menu or execute the specified command

### Requirement: Argument parsing
The system SHALL parse command-line arguments to determine the operation mode.

#### Scenario: Parse --help argument
- **WHEN** user runs `release-cherry-pick --help`
- **THEN** the system SHALL display usage information and available commands

#### Scenario: Parse --version argument
- **WHEN** user runs `release-cherry-pick --version`
- **THEN** the system SHALL display the current version number

### Requirement: Logging system
The system SHALL implement a logging system that outputs messages to the console.

#### Scenario: Log info messages
- **WHEN** the system needs to display informational messages
- **THEN** messages SHALL be displayed in green color for success, yellow for warnings, and red for errors

### Requirement: Error handling
The system SHALL handle errors gracefully and provide meaningful error messages.

#### Scenario: Handle missing dependencies
- **WHEN** required system dependencies are missing (git, node)
- **THEN** the system SHALL display a clear error message indicating which dependency is missing and how to install it