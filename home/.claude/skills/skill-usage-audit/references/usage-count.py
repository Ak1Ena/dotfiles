import collections
import glob
import json
import os
import re

ROOT = os.path.expanduser('~/.claude/projects')
skill = collections.Counter()
slash = collections.Counter()
agent = collections.Counter()
mcp = collections.Counter()

for path in glob.glob(os.path.join(ROOT, '**', '*.jsonl'), recursive=True):
    with open(path, errors='ignore') as fh:
        for line in fh:
            if '"tool_use"' not in line and 'command-name' not in line:
                continue
            try:
                rec = json.loads(line)
            except ValueError:
                continue
            msg = rec.get('message') or {}
            content = msg.get('content') if isinstance(msg, dict) else None
            if isinstance(content, list):
                for block in content:
                    if not isinstance(block, dict) or block.get('type') != 'tool_use':
                        continue
                    name = block.get('name', '')
                    inp = block.get('input') or {}
                    if name == 'Skill':
                        skill[inp.get('skill', '?')] += 1
                    elif name == 'Agent' and inp.get('subagent_type'):
                        agent[inp['subagent_type']] += 1
                    elif name.startswith('mcp__'):
                        mcp[name.split('__')[1]] += 1
            text = content if isinstance(content, str) else json.dumps(content or '')
            for cmd in re.findall(r'<command-name>/?([\w:-]+)</command-name>', text):
                slash[cmd] += 1

for title, counter in (('Skill tool', skill), ('slash commands', slash), ('subagent types', agent), ('mcp servers', mcp)):
    print('==', title)
    for key, n in counter.most_common():
        print(n, key)
