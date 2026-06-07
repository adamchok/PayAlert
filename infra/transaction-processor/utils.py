from __future__ import annotations

from decimal import Decimal
from typing import Any


def clean_item(obj: Any) -> Any:
    """Recursively strip None values and convert floats to Decimal for DynamoDB."""
    if isinstance(obj, dict):
        return {k: clean_item(v) for k, v in obj.items() if v is not None}
    if isinstance(obj, list):
        return [clean_item(v) for v in obj]
    if isinstance(obj, float):
        return Decimal(str(obj))
    return obj
