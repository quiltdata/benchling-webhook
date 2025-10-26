# Changelog

All notable changes to this project will be documented in this file.

## [0.4.7] - 2025-10-26

### Fixed
- Fix API Gateway CloudWatch log group deployment conflict by adding explicit configuration with retention policy

### Changed
- Configure API Gateway access logs with explicit name and 7-day retention
- Set log group removal policy to RETAIN for deployment stability
