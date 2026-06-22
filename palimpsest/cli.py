import argparse
import sys

from palimpsest.config import get_config
from palimpsest.highlight.services import build_highlighter, project_highlight_health
from palimpsest.workbench.app import create_app


COMMANDS = {"workbench", "highlight"}
LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}


def main(argv=None):
    raw_argv = sys.argv[1:] if argv is None else argv

    parser = build_parser()
    args = parser.parse_args(normalize_argv(raw_argv))

    return args.func(args)


def normalize_argv(argv):
    """
    Preserve the old convenient forms:

        palimpsest
        palimpsest ~/Projects/foo
        palimpsest --port 5001

    while still supporting explicit subcommands:

        palimpsest workbench ~/Projects/foo
        palimpsest highlight check
        palimpsest highlight build parser-id
        palimpsest highlight build --all
    """
    argv = list(argv)

    if not argv:
        return ["workbench"]

    first = argv[0]

    if first in COMMANDS or first in ("-h", "--help"):
        return argv

    return ["workbench", *argv]


def build_parser():
    parser = argparse.ArgumentParser(
        prog="palimpsest",
        description="Palimpsest grammar workbench and highlighter tools.",
    )

    subparsers = parser.add_subparsers(
        dest="command",
        metavar="command",
    )

    add_workbench_parser(subparsers)
    add_highlight_parser(subparsers)

    return parser


def add_workbench_parser(subparsers):
    parser = subparsers.add_parser(
        "workbench",
        help="Run the Palimpsest grammar workbench.",
        description="Run the Palimpsest grammar workbench for a project.",
    )

    add_project_config_args(parser)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5000)
    parser.add_argument("--debug", action="store_true")

    parser.set_defaults(func=run_workbench)

    return parser


def add_highlight_parser(subparsers):
    parser = subparsers.add_parser(
        "highlight",
        help="Check and build browser highlighters.",
        description="Check and build browser highlighters declared in palimpsest.toml.",
    )

    highlight_subparsers = parser.add_subparsers(
        dest="highlight_command",
        metavar="command",
        required=True,
    )

    add_highlight_check_parser(highlight_subparsers)
    add_highlight_build_parser(highlight_subparsers)

    return parser


def add_highlight_check_parser(subparsers):
    parser = subparsers.add_parser(
        "check",
        help="Validate configured highlighter inputs.",
        description="Validate configured highlighter inputs.",
    )

    add_project_config_args(parser)
    parser.set_defaults(func=run_highlight_check)

    return parser


def add_highlight_build_parser(subparsers):
    parser = subparsers.add_parser(
        "build",
        help="Build one or more configured highlighters.",
        description="Build one or more configured highlighters.",
    )

    parser.add_argument(
        "parser_id",
        nargs="?",
        help="Configured parser/highlighter id to build.",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Build every configured highlighter.",
    )

    add_project_config_args(parser)
    parser.set_defaults(func=run_highlight_build)

    return parser


def add_project_config_args(parser):
    parser.add_argument(
        "project_dir",
        nargs="?",
        help="Project directory. Defaults to the current working directory.",
    )
    parser.add_argument(
        "-c",
        "--config",
        help="Path to palimpsest.toml. Defaults to palimpsest.toml in the project directory.",
    )


def run_workbench(args):
    if args.host not in LOCAL_HOSTS:
        print(
            "Warning: Palimpsest can edit files and run configured project build commands. "
            f"Binding to {args.host!r} may expose those controls beyond this machine.",
            file=sys.stderr,
        )

    app = create_app(cwd=args.project_dir, config_path=args.config)
    app.run(host=args.host, port=args.port, debug=args.debug)

    return 0


def run_highlight_check(args):
    config = get_config(cwd=args.project_dir, config_path=args.config)
    return highlight_check(config)


def run_highlight_build(args):
    if args.all and args.parser_id:
        print("error: specify either parser_id or --all, not both", file=sys.stderr)
        return 2

    if not args.all and not args.parser_id:
        print("error: specify parser_id or --all", file=sys.stderr)
        return 2

    config = get_config(cwd=args.project_dir, config_path=args.config)

    parser_ids = (
        [parser.id for parser in config.parser_configs if parser.build.has_build]
        if args.all
        else [args.parser_id]
    )

    return highlight_build(config, parser_ids)


def highlight_check(config):
    health = project_highlight_health(config)

    print(f"Project: {config.cwd}")
    print(f"Config: {config.config_path}")

    for check in health["dependencies"]:
        status = "ok" if check["ok"] else "missing"
        detail = f" ({check['path']})" if check.get("path") else ""
        print(f"dependency {check['name']}: {status}{detail}")

    for parser in health["parsers"]:
        status = "ok" if parser["ok"] else "not ready"
        print(f"highlighter {parser['id']}: {status}")

        for output in parser["outputs"]:
            output_status = "exists" if output["exists"] else "missing"
            print(f"  output {output['path']}: {output_status}")

    return 0 if health["ok"] else 1


def highlight_build(config, parser_ids):
    if not parser_ids:
        print("No configured highlighters declare a build command.", file=sys.stderr)
        return 1

    exit_code = 0

    for parser_id in parser_ids:
        try:
            result, status = build_highlighter(config, parser_id)
        except ValueError:
            print(f"{parser_id}: build path must stay inside the configured cwd", file=sys.stderr)
            return 1

        print(f"{parser_id}: {'ok' if result.get('ok') else 'failed'}")

        if result.get("command"):
            print(f"  command: {result['command']}")

        if result.get("stdout"):
            print(
                result["stdout"],
                end="" if result["stdout"].endswith("\n") else "\n",
            )

        if result.get("stderr"):
            print(
                result["stderr"],
                file=sys.stderr,
                end="" if result["stderr"].endswith("\n") else "\n",
            )

        if status >= 400 or not result.get("ok"):
            exit_code = 1

    return exit_code


if __name__ == "__main__":
    sys.exit(main())
