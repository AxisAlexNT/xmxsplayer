"""Run the installed Carla engine with its native editor and state API on stdin."""
import json
import os
import queue
import signal
import sys
import threading
import time

module_dir, library_dir, driver, port, project = sys.argv[1:]
sys.path.insert(0, module_dir)
from carla_backend import (
    CarlaHostDLL, ENGINE_OPTION_PROCESS_MODE, ENGINE_PROCESS_MODE_PATCHBAY,
    ENGINE_OPTION_TRANSPORT_MODE, ENGINE_TRANSPORT_MODE_INTERNAL,
    ENGINE_OPTION_OSC_ENABLED, ENGINE_OPTION_OSC_PORT_UDP, ENGINE_OPTION_OSC_PORT_TCP,
    ENGINE_OPTION_PATH_BINARIES, ENGINE_OPTION_PATH_RESOURCES, PLUGIN_HAS_CUSTOM_UI,
)

host = CarlaHostDLL(os.path.join(library_dir, "libcarla_standalone2.so"), False)
for option, value, text in [
    (ENGINE_OPTION_PROCESS_MODE, ENGINE_PROCESS_MODE_PATCHBAY, ""),
    (ENGINE_OPTION_TRANSPORT_MODE, ENGINE_TRANSPORT_MODE_INTERNAL, ""),
    (ENGINE_OPTION_PATH_BINARIES, 0, library_dir),
    (ENGINE_OPTION_PATH_RESOURCES, 0, os.path.join(library_dir, "resources")),
    (ENGINE_OPTION_OSC_ENABLED, 1, ""),
    (ENGINE_OPTION_OSC_PORT_UDP, int(port), ""),
    (ENGINE_OPTION_OSC_PORT_TCP, -1, ""),
]:
    host.set_engine_option(option, value, text)

commands = queue.Queue()
stopping = threading.Event()

def read_commands():
    try:
        for line in sys.stdin:
            commands.put(json.loads(line))
    finally:
        stopping.set()

def command(message):
    index = message["index"]
    if not 0 <= index < host.get_current_plugin_count():
        raise ValueError("Plugin instance is unavailable")
    operation = message["op"]
    if operation == "editor":
        if not host.get_plugin_info(index)["hints"] & PLUGIN_HAS_CUSTOM_UI:
            raise ValueError("This plugin has no native editor")
        host.show_custom_ui(index, True)
    elif operation == "save":
        if not host.save_plugin_state(index, message["path"]):
            raise RuntimeError(host.get_last_error())
    elif operation == "load":
        if not host.load_plugin_state(index, message["path"]):
            raise RuntimeError(host.get_last_error())
    else:
        raise ValueError("Unknown plugin operation")

signal.signal(signal.SIGTERM, lambda *_: stopping.set())
if not host.engine_init(driver, "Carla"):
    raise RuntimeError(host.get_last_error())
try:
    if not host.load_project(project):
        raise RuntimeError(host.get_last_error())
    threading.Thread(target=read_commands, daemon=True).start()
    print("Carla ready!", flush=True)
    while not stopping.is_set() and host.is_engine_running():
        host.engine_idle()
        try:
            message = commands.get(timeout=0.01)
        except queue.Empty:
            continue
        reply = {"request": message["request"]}
        try:
            command(message)
        except Exception as error:
            reply["error"] = str(error)
        print("XMXS " + json.dumps(reply), flush=True)
finally:
    host.engine_close()
