"""AWS authentication and role management.

This module provides role assumption capabilities for cross-account AWS access.
"""

from .role_manager import RoleManager

__all__ = ["RoleManager"]
