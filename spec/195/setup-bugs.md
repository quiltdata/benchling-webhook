# SETUP BUGS

## 1. bucket should NOT be part of Quilt Config

- The rest of Quilt config is inferred from the catalog
- the bucket MUST be manually entered
- it is independentaly validate (via a boto3 call)

