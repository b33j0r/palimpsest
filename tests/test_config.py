import unittest

import pydantic

from palimpsest.config import ProjectConfig


class HighlightCaptureConfigTests(unittest.TestCase):
    def test_inline_capture_maps_still_work(self):
        config = ProjectConfig.model_validate({
            "parsers": {
                "demo": {
                    "highlight_captures": {"symbol": "variable"},
                },
            },
        })

        self.assertEqual(config.parsers[0].highlight_captures, {"symbol": "variable"})

    def test_named_capture_map_references_resolve(self):
        config = ProjectConfig.model_validate({
            "capture_maps": {
                "demo": {"symbol": "variable"},
            },
            "parsers": {
                "demo": {
                    "highlight_captures": "demo",
                },
            },
        })

        self.assertEqual(config.parsers[0].highlight_captures, {"symbol": "variable"})

    def test_filetypes_inherit_parser_captures(self):
        config = ProjectConfig.model_validate({
            "capture_maps": {
                "demo": {"symbol": "variable"},
            },
            "parsers": {
                "demo": {
                    "highlight_captures": "demo",
                },
            },
            "filetypes": {
                "demo": {
                    "extensions": ["*.demo"],
                    "parser": "demo",
                },
            },
        })

        self.assertEqual(config.filetypes[0].highlight_captures, {"symbol": "variable"})

    def test_filetypes_can_inherit_by_matching_id(self):
        config = ProjectConfig.model_validate({
            "parsers": {
                "demo": {
                    "highlight_captures": {"symbol": "variable"},
                },
            },
            "filetypes": {
                "demo": {
                    "extensions": ["*.demo"],
                },
            },
        })

        self.assertEqual(config.filetypes[0].highlight_captures, {"symbol": "variable"})

    def test_filetype_captures_extend_parser_captures(self):
        config = ProjectConfig.model_validate({
            "parsers": {
                "demo": {
                    "highlight_captures": {"symbol": "variable"},
                },
            },
            "filetypes": {
                "demo": {
                    "extensions": ["*.demo"],
                    "parser": "demo",
                    "highlight_captures": {"handler": "function"},
                },
            },
        })

        self.assertEqual(
            config.filetypes[0].highlight_captures,
            {"symbol": "variable", "handler": "function"},
        )

    def test_unknown_capture_map_reference_fails(self):
        with self.assertRaises(pydantic.ValidationError) as error:
            ProjectConfig.model_validate({
                "parsers": {
                    "demo": {
                        "highlight_captures": "missing",
                    },
                },
            })

        self.assertIn("Unknown capture map 'missing'", str(error.exception))


if __name__ == "__main__":
    unittest.main()
