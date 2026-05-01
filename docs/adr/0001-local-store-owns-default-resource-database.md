# Local Store Owns the Default Resource Database

OnlyWrite is a local-only personal writing resource system, so the CLI must work without requiring a web/API server to be running. We store the default resource database under `~/.onlywrite` and let the CLI operate on it directly, while the local API and Local Resource Viewer act as service layers over the same database. OnlyWrite does not provide a cloud service or require login for local resource access.
