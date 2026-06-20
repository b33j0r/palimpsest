from pathlib import Path

import pydantic


class Config(pydantic.BaseModel):
    cwd: Path = Path.cwd()


def get_config():
    return Config()