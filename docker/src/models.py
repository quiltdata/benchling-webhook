from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Any, Dict, Optional

from dataclasses_json import dataclass_json


class ExportStatus(Enum):
    RUNNING = "RUNNING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"


@dataclass_json
@dataclass
class ProcessExportTask:
    download_url: str
    package_name: str
    registry: str
    entry_id: str
    task_id: str


@dataclass_json
@dataclass
class ExportResult:
    status: ExportStatus
    download_url: Optional[str] = None
    error_message: Optional[str] = None


@dataclass_json
@dataclass
class WebhookEvent:
    channel: str
    message: Dict[str, Any]
    base_url: str
    timestamp: datetime
    event_id: str


@dataclass_json
@dataclass
class WebhookResponse:
    execution_arn: str
    status: str = "ACCEPTED"
    message: str = "Processing started"
