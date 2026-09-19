## Purpose

Generar reportes de resumen del proceso de release con estado de cada operación y enlaces a MRs creados.

## ADDED Requirements

### Requirement: Operation summary generation
The system SHALL generate a comprehensive summary after completing the release process.

#### Scenario: Display release summary
- **WHEN** release process completes
- **THEN** the system SHALL display a summary table with branch name, status (PROCEDE/NO PROCEDE), and MR link

#### Scenario: Include timestamp
- **WHEN** generating summary
- **THEN** the system SHALL include the date and time of the release operation

### Requirement: MR link tracking
The system SHALL track and display MR links for each created Merge Request.

#### Scenario: Display MR links
- **WHEN** MRs are created
- **THEN** the system SHALL display clickable links to each MR in GitLab

### Requirement: Export summary
The system SHALL allow exporting the summary to a file.

#### Scenario: Export to markdown
- **WHEN** user requests export
- **THEN** the system SHALL save the summary as a markdown file in the project root

### Requirement: Conflict reporting
The system SHALL provide detailed information about conflicts.

#### Scenario: Report conflicting files
- **WHEN** cherry-pick fails due to conflicts
- **THEN** the system SHALL list the specific files that have conflicts