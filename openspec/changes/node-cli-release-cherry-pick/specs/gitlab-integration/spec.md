## Purpose

Integrar con la API de GitLab para crear Merge Requests automatizados con títulos y descripciones generadas.

## ADDED Requirements

### Requirement: GitLab authentication
The system SHALL authenticate with GitLab using personal access tokens.

#### Scenario: Validate token permissions
- **WHEN** user provides GitLab token
- **THEN** the system SHALL validate the token has required permissions (api scope)

#### Scenario: Handle authentication failure
- **WHEN** token is invalid or expired
- **THEN** the system SHALL display clear error message and prompt for new token

### Requirement: MR creation
The system SHALL create Merge Requests in GitLab.

#### Scenario: Create MR with title format
- **WHEN** creating a Merge Request
- **THEN** the system SHALL use format `[TASK-ID] Description` as title

#### Scenario: Set MR source and target branches
- **WHEN** creating a Merge Request
- **THEN** the system SHALL set source branch as release branch and target as staging

#### Scenario: Add MR description
- **WHEN** creating a Merge Request
- **THEN** the system SHALL generate description from source branch commits

### Requirement: AI-powered descriptions
The system SHALL optionally use AI to generate MR descriptions.

#### Scenario: Generate AI description
- **WHEN** AI is enabled and configured
- **THEN** the system SHALL send commit messages to AI provider and use generated description

#### Scenario: Fallback to manual description
- **WHEN** AI generation fails
- **THEN** the system SHALL fall back to using commit messages directly

### Requirement: MR link retrieval
The system SHALL retrieve the created MR URL for user reference.

#### Scenario: Get MR URL
- **WHEN** MR is successfully created
- **THEN** the system SHALL return the MR URL for display in summary