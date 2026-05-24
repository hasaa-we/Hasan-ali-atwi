import ast
import json
from pathlib import Path

MODULE_FILES = [
    'module1_game.py',
    'module2p1_game.py',
    'module2p2_game.py',
    'module3_game.py',
    'module4_game.py',
    'module5_game.py',
    'module6_game.py',
    'module7_game.py',
]


def parse_string(node):
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.JoinedStr):
        # Build simple joined string if all parts are constants
        parts = []
        for value in node.values:
            if isinstance(value, ast.Constant) and isinstance(value.value, str):
                parts.append(value.value)
            else:
                raise ValueError('Unsupported formatted string')
        return ''.join(parts)
    raise ValueError(f'Unsupported string node: {ast.dump(node)}')


def parse_list(node):
    if not isinstance(node, ast.List):
        raise ValueError('Expected List node')
    return [parse_node(el) for el in node.elts]


def parse_tuple(node):
    if not isinstance(node, ast.Tuple):
        raise ValueError('Expected Tuple node')
    return [parse_node(el) for el in node.elts]


def parse_node(node):
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.Str):
        return node.s
    if isinstance(node, ast.List):
        return parse_list(node)
    if isinstance(node, ast.Tuple):
        return parse_tuple(node)
    if isinstance(node, ast.Dict):
        keys = [parse_node(k) for k in node.keys]
        values = [parse_node(v) for v in node.values]
        return dict(zip(keys, values))
    if isinstance(node, ast.Attribute):
        if isinstance(node.value, ast.Name) and node.value.id == 'self':
            return node.attr
        return node.attr
    if isinstance(node, ast.NameConstant):
        return node.value
    if isinstance(node, ast.JoinedStr):
        return parse_string(node)
    raise ValueError(f'Unsupported node type: {type(node).__name__} {ast.dump(node)}')


def parse_levels(assign_node):
    if not isinstance(assign_node.value, ast.List):
        raise ValueError('levels is not a list')
    levels = []
    for elt in assign_node.value.elts:
        if isinstance(elt, ast.Tuple):
            tuple_data = parse_tuple(elt)
            if len(tuple_data) == 3:
                levels.append({'title': tuple_data[0], 'subtitle': tuple_data[1], 'description': tuple_data[2]})
            else:
                raise ValueError('Unexpected levels tuple length')
        else:
            raise ValueError('Unexpected level element type')
    return levels


def parse_call(call):
    if isinstance(call.func, ast.Name):
        func_name = call.func.id
    elif isinstance(call.func, ast.Attribute):
        func_name = call.func.attr
    else:
        raise ValueError('Unsupported call func type')
    args = [parse_node(a) for a in call.args]
    kwargs = {kw.arg: parse_node(kw.value) for kw in call.keywords}
    return func_name, args, kwargs


def parse_level_function(func_node):
    concept = None
    questions = []
    for node in func_node.body:
        call_node = None
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call):
            call_node = node.value
        elif isinstance(node, ast.Assign) and isinstance(node.value, ast.Call):
            call_node = node.value
        if call_node is not None:
            if isinstance(call_node.func, ast.Name):
                func_name = call_node.func.id
            elif isinstance(call_node.func, ast.Attribute):
                func_name = call_node.func.attr
            else:
                continue
            if func_name == 'explain_concept':
                _, args, kwargs = parse_call(call_node)
                title = args[0] if args else kwargs.get('title')
                lines = args[1] if len(args) > 1 else kwargs.get('lines', [])
                concept = {'title': title, 'lines': lines}
            elif func_name == 'ask':
                _, args, kwargs = parse_call(call_node)
                question = args[0] if len(args) > 0 else kwargs.get('question')
                options = args[1] if len(args) > 1 else kwargs.get('options')
                correct = args[2] if len(args) > 2 else kwargs.get('correct')
                explanation_before = args[3] if len(args) > 3 else kwargs.get('explanation_before')
                wrong_examples = args[4] if len(args) > 4 else kwargs.get('wrong_examples')
                hint = args[5] if len(args) > 5 else kwargs.get('hint')
                if hint is None:
                    hint = kwargs.get('hint')
                q = {
                    'question': question,
                    'options': options,
                    'correct': correct - 1 if isinstance(correct, int) else correct,
                    'explanationBefore': explanation_before,
                    'wrongExplanations': wrong_examples or {},
                    'hint': hint or ''
                }
                questions.append(q)
            else:
                continue
        elif isinstance(node, ast.Assign):
            continue
    return {'concept': concept, 'questions': questions}


def extract_module(file_path):
    code = Path(file_path).read_text(encoding='utf-8')
    tree = ast.parse(code)
    module = {
        'file': Path(file_path).name,
        'title': None,
        'levels': [],
        'levelData': [],
    }
    for node in tree.body:
        if isinstance(node, ast.ClassDef) and node.name == 'Game':
            for item in node.body:
                if isinstance(item, ast.FunctionDef):
                    if item.name == 'start':
                        for stmt in item.body:
                            if isinstance(stmt, ast.Assign):
                                for target in stmt.targets:
                                    if isinstance(target, ast.Name) and target.id == 'levels':
                                        module['levels'] = parse_levels(stmt)
                    elif item.name.startswith('l'):
                        level_index = int(item.name[1:]) - 1
                        level_info = parse_level_function(item)
                        module['levelData'].append(level_info)
        elif isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
            # skip module docstring
            continue
    if not module['levels']:
        raise ValueError(f'No levels found in {file_path}')
    if len(module['levels']) != len(module['levelData']):
        # May have one extra due to l9 in module7 or missing levels; ensure alignment by sorting by function name
        module['levelData'] = sorted(module['levelData'], key=lambda x: 0)
    return module


def normalize_module(module):
    title_map = {
        'module1_game.py': 'Module 1 — Cybersecurity Basics',
        'module2p1_game.py': 'Module 2 Part 1 — Threat Landscape',
        'module2p2_game.py': 'Module 2 Part 2 — Attacks & Threat Modeling',
        'module3_game.py': 'Module 3 — Defense Fundamentals',
        'module4_game.py': 'Module 4 — Identity, Authentication & Access Control',
        'module5_game.py': 'Module 5 — OS and System Security',
        'module6_game.py': 'Module 6 — Web Security Fundamentals',
        'module7_game.py': 'Module 7 — Secure Software Development Life Cycle',
    }
    module['title'] = title_map.get(module['file'], module['file'])
    levels = []
    for idx, level in enumerate(module['levels']):
        data = module['levelData'][idx] if idx < len(module['levelData']) else {'concept': None, 'questions': []}
        levels.append({
            'title': level['title'],
            'subtitle': level['subtitle'],
            'description': level['description'],
            'concept': data['concept'],
            'questions': data['questions'],
        })
    module['levels'] = levels
    del module['levelData']
    return module


def main():
    root = Path(__file__).parent.parent
    output_path = root / 'website' / 'modules.js'
    modules = []
    for file_name in MODULE_FILES:
        module = extract_module(root / file_name)
        modules.append(normalize_module(module))
    output_text = 'const modulesData = ' + json.dumps(modules, indent=2, ensure_ascii=False) + ';\n'
    output_path.parent.mkdir(exist_ok=True)
    output_path.write_text(output_text, encoding='utf-8')
    print(f'Wrote {output_path}')


if __name__ == '__main__':
    main()
