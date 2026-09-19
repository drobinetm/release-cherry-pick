## Purpose

Orquestar el proceso de cherry-pick de ramas feature/hotfix hacia ramas de release con manejo de conflictos.

## ADDED Requirements

### Requirement: Release branch creation
The system SHALL create release branches from the staging branch.

#### Scenario: Create release branch from staging
- **WHEN** user initiates release process
- **THEN** the system SHALL create a new branch from staging with the pattern `release/<task-id>-<description>`

#### Scenario: Handle existing release branch
- **WHEN** a release branch already exists
- **THEN** the system SHALL ask user whether to overwrite or skip

### Requirement: Cherry-pick execution
The system SHALL execute cherry-pick of commits from source branches to release branches.

#### Scenario: Cherry-pick single commit
- **WHEN** source branch has commits to cherry-pick
- **THEN** the system SHALL execute `git cherry-pick` for each commit

#### Scenario: Cherry-pick multiple commits
- **WHEN** source branch has multiple commits
- **THEN** the system SHALL cherry-pick commits in chronological order

### Requirement: Conflict detection and handling
The system SHALL detect and handle cherry-pick conflicts.

#### Scenario: Detect conflicts
- **WHEN** cherry-pick encounters conflicts
- **THEN** the system SHALL mark the operation as "NO PROCEDE" and log the conflicting files

#### Scenario: Report conflict details
- **WHEN** conflicts are detected
- **THEN** the system SHALL display which files have conflicts and suggest resolution

### Requirement: Success tracking
The system SHALL track which cherry-picks succeeded and which failed.

#### Scenario: Mark successful cherry-pick
- **WHEN** cherry-pick completes without conflicts
- **THEN** the system SHALL mark the operation as "PROCEDE"

#### Scenario: Generate operation report
- **WHEN** all cherry-picks are complete
- **THEN** the system SHALL generate a summary showing PROCEDE/NO PROCEDE status for each branch