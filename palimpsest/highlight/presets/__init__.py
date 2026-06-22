from palimpsest.highlight.config import BUILD_PRESETS, BuildPresetRegistry
from palimpsest.highlight.presets.cargo_wasm_bindgen import CargoWasmBindgenBuildPreset
from palimpsest.highlight.presets.lezer import LezerBuildPreset
from palimpsest.highlight.presets.tree_sitter import TreeSitterBuildPreset


def register_build_presets(registry: BuildPresetRegistry = BUILD_PRESETS) -> None:
    registry.register(CargoWasmBindgenBuildPreset())
    registry.register(LezerBuildPreset())
    registry.register(TreeSitterBuildPreset())


register_build_presets()


__all__ = [
    "CargoWasmBindgenBuildPreset",
    "LezerBuildPreset",
    "TreeSitterBuildPreset",
    "register_build_presets",
]
