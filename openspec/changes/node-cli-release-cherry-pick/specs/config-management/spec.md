## Purpose

Gestionar configuraciones persistentes incluyendo ramas, proveedores Git y opciones de IA para el proceso de release.

## ADDED Requirements

### Requirement: Configuration file storage
The system SHALL store configuration in a `.release-cherry-pick.json` file in the project root.

#### Scenario: Create configuration file
- **WHEN** the configuration file does not exist
- **THEN** the system SHALL create it with default values and prompt the user for initial setup

#### Scenario: Load existing configuration
- **WHEN** the configuration file exists
- **THEN** the system SHALL load and validate the configuration before proceeding

### Requirement: Branch configuration
The system SHALL allow users to configure branch naming patterns.

#### Scenario: Configure branch prefix
- **WHEN** user configures branch prefix
- **THEN** the system SHALL store the prefix and use it when creating release branches

#### Scenario: Configure staging branch name
- **WHEN** user configures the staging branch name
- **THEN** the system SHALL use this as the base for creating release branches

### Requirement: GitLab provider configuration
The system SHALL store GitLab connection settings.

#### Scenario: Configure GitLab URL
- **WHEN** user provides GitLab instance URL
- **THEN** the system SHALL store the URL and validate connectivity

#### Scenario: Configure GitLab token
- **WHEN** user provides personal access token
- **THEN** the system SHALL store the token securely and validate permissions

### Requirement: AI provider configuration
The system SHALL optionally store AI provider settings for generating MR descriptions.

#### Scenario: Configure AI provider
- **WHEN** user enables AI description generation
- **THEN** the system SHALL store provider settings and API keys

### Requirement: Configuration validation
The system SHALL validate all configuration values before proceeding with operations.

#### Scenario: Validate required fields
- **WHEN** configuration is loaded
- **THEN** the system SHALL verify all required fields are present and valid