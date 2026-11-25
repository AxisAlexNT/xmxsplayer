"""Read installed LV2 port names and ranges through Carla's system Lilv library."""
import ctypes as c
import ctypes.util
import json
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit

lib = c.CDLL(ctypes.util.find_library("lilv-0") or "liblilv-0.so.0")
ptr = c.c_void_p

def api(name, result, *args):
    fn = getattr(lib, "lilv_" + name)
    fn.restype = result
    fn.argtypes = args
    return fn

new_world = api("world_new", ptr)
free_world = api("world_free", None, ptr)
load = api("world_load_all", None, ptr)
all_plugins = api("world_get_all_plugins", ptr, ptr)
lookup = api("plugins_get_by_uri", ptr, ptr, ptr)
uri = api("new_uri", ptr, ptr, c.c_char_p)
free = api("node_free", None, ptr)
string = api("node_as_string", c.c_char_p, ptr)
number = api("node_as_float", c.c_float, ptr)
count = api("plugin_get_num_ports", c.c_uint32, ptr)
port_at = api("plugin_get_port_by_index", ptr, ptr, c.c_uint32)
is_a = api("port_is_a", c.c_bool, ptr, ptr, ptr)
name = api("port_get_name", ptr, ptr, ptr)
port_range = api("port_get_range", None, ptr, ptr, *([c.POINTER(ptr)] * 3))
port_get = api("port_get", ptr, ptr, ptr, ptr)
has_property = api("port_has_property", c.c_bool, ptr, ptr, ptr)
world_ask = api("world_ask", c.c_bool, ptr, ptr, ptr, ptr)
def catalog(world, plugins, types):
    begin = api("plugins_begin", ptr, ptr)
    end = api("plugins_is_end", c.c_bool, ptr, ptr)
    get = api("plugins_get", ptr, ptr, ptr)
    advance = api("plugins_next", ptr, ptr, ptr)
    identity = api("plugin_get_uri", ptr, ptr)
    bundle = api("plugin_get_bundle_uri", ptr, ptr)
    title = api("plugin_get_name", ptr, ptr)
    author = api("plugin_get_author_name", ptr, ptr)
    supports = api("port_supports_event", c.c_bool, ptr, ptr, ptr)
    uis = api("plugin_get_uis", ptr, ptr)
    ui_count = api("uis_size", c.c_uint, ptr)
    free_uis = api("uis_free", None, ptr)
    types["instrument"] = uri(world, b"http://lv2plug.in/ns/lv2core#InstrumentPlugin")
    types["rdfType"] = uri(world, b"http://www.w3.org/1999/02/22-rdf-syntax-ns#type")
    types["midi"] = uri(world, b"http://lv2plug.in/ns/ext/midi#MidiEvent")

    def owned_text(node):
        if not node:
            return ""
        try:
            return string(node).decode()
        finally:
            free(node)

    rows = []
    iterator = begin(plugins)
    while not end(plugins, iterator):
        plugin = get(plugins, iterator)
        iterator = advance(plugins, iterator)
        node = identity(plugin)
        key = string(node).decode()
        path = Path(unquote(urlsplit(string(bundle(plugin)).decode()).path))
        inputs = outputs = midi = parameters = 0
        for index in range(count(plugin)):
            port = port_at(plugin, index)
            incoming = is_a(plugin, port, types["InputPort"])
            if is_a(plugin, port, types["AudioPort"]):
                inputs += incoming
                outputs += not incoming
            if incoming:
                midi += supports(plugin, port, types["midi"])
                parameters += is_a(plugin, port, types["ControlPort"])
        editors = uis(plugin)
        has_editor = bool(editors and ui_count(editors))
        free_uis(editors)
        rows.append(dict(uri=key, format="lv2", file=str(path),
                         name=owned_text(title(plugin)) or key, maker=owned_text(author(plugin)),
                         instrument=world_ask(world, node, types["rdfType"], types["instrument"]),
                         customUi=has_editor, audioInputs=inputs, audioOutputs=outputs,
                         midiInputs=midi, parameters=parameters, uniqueId=0))
    return rows

world = new_world()
types = {}
try:
    load(world)
    plugins = all_plugins(world)
    for kind in ["AudioPort", "InputPort", "ControlPort"]:
        types[kind] = uri(world, ("http://lv2plug.in/ns/lv2core#" + kind).encode())
    groups = "http://lv2plug.in/ns/ext/port-groups#"
    types["group"] = uri(world, (groups + "group").encode())
    types["sideChainOf"] = uri(world, (groups + "sideChainOf").encode())
    types["isSideChain"] = uri(world, b"http://lv2plug.in/ns/lv2core#isSideChain")
    if "--catalog" in sys.argv:
        print(json.dumps(catalog(world, plugins, types)))
        sys.exit(0)
    results = {}
    for key in json.load(sys.stdin):
        node = uri(world, key.encode())
        plugin = lookup(plugins, node)
        free(node)
        if not plugin:
            continue
        inputs, outputs, parameters, sidechains = [], [], [], []
        for index in range(count(plugin)):
            port = port_at(plugin, index)
            label = name(plugin, port)
            text = string(label).decode() if label else str(index)
            free(label)
            incoming = is_a(plugin, port, types["InputPort"])
            if is_a(plugin, port, types["AudioPort"]):
                (inputs if incoming else outputs).append(text)
                if incoming:
                    group = port_get(plugin, port, types["group"])
                    if (has_property(plugin, port, types["isSideChain"]) or
                            (group and world_ask(world, group, types["sideChainOf"], None))):
                        sidechains.append(text)
                    free(group)
            elif is_a(plugin, port, types["ControlPort"]):
                default, low, high = ptr(), ptr(), ptr()
                port_range(plugin, port, c.byref(default), c.byref(low), c.byref(high))
                parameters.append(dict(index=len(parameters), name=text, input=incoming,
                                       min=number(low) if low else 0, max=number(high) if high else 1,
                                       initial=number(default) if default else 0))
                for value in [default, low, high]:
                    free(value)
        results[key] = dict(inputs=inputs, outputs=outputs, parameters=parameters, sidechains=sidechains)
    print(json.dumps(results, allow_nan=False))
finally:
    for node in types.values():
        free(node)
    free_world(world)
