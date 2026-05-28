"""Pydantic schemas fastapi-users requires to serialize / deserialize User.

We don't expose registration or password-change in the API surface
(OAuth-only), but the library still wants these types for the typed routes
it builds internally. Keeping them minimal — same fields as the SQLAlchemy
model, no extensions.
"""

import uuid

from fastapi_users import schemas


class UserRead(schemas.BaseUser[uuid.UUID]):
    pass


class UserCreate(schemas.BaseUserCreate):
    pass


class UserUpdate(schemas.BaseUserUpdate):
    pass
