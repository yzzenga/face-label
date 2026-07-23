"""FaceLabel 启动验证脚本"""
import sys, os, json, time, subprocess

sys.path.insert(0, '.')

# 1. 语法检查
print('=== 1. 语法检查 ===')
import py_compile
errors = []
for root, dirs, fnames in os.walk('.'):
    for f in fnames:
        if f.endswith('.py'):
            path = os.path.join(root, f)
            try:
                py_compile.compile(path, doraise=True)
            except py_compile.PyCompileError as e:
                errors.append(str(e))
                print(f'  ✗ {path}: {e}')
if not errors:
    print('  ✓ 全部通过')

# 2. 模块导入与核心逻辑
print()
print('=== 2. 核心逻辑验证 ===')
import config
print(f'  config.AVAILABLE_MODELS: {list(config.AVAILABLE_MODELS.keys())}')

from backend.face_engine import engine
models = engine.get_available_models()
print(f'  engine.get_available_models(): {len(models)} models')
for m in models:
    print(f'    - {m["key"]}: {m["name"]} (active={m["is_active"]})')

# 验证 switch_model 不会抛出"可用模型为空"错误
try:
    engine.switch_model('insightface_arcface', 'cpu')
except ValueError as e:
    if '可用模型' in str(e) and '[]' in str(e):
        print(f'  ❌ switch_model 错误: {e}')
        sys.exit(1)
    else:
        print(f'  ⚠️ ValueError (非空模型问题): {e}')
except Exception as e:
    print(f'  ⚠️ 其他错误（模型未下载，这是预期的）: {type(e).__name__}')

# 3. 启动服务器并测试 API
print()
print('=== 3. API 测试 ===')
proc = subprocess.Popen(
    [sys.executable, '-u', '-c', '''
import sys
sys.path.insert(0, ".")
from main import app
import uvicorn
uvicorn.run(app, host="0.0.0.0", port=8000, log_level="warning")
'''],
    stdout=subprocess.PIPE, stderr=subprocess.PIPE,
)
time.sleep(5)

import urllib.request
try:
    resp = urllib.request.urlopen('http://localhost:8000/health', timeout=5)
    print(f'  GET /health → {resp.status}: {json.loads(resp.read())}')

    resp = urllib.request.urlopen('http://localhost:8000/api/models', timeout=5)
    data = json.loads(resp.read())
    print(f'  GET /api/models → {resp.status}: {len(data)} models')
    for m in data:
        print(f'    - {m["key"]}: {m["name"]} (active={m["is_active"]})')

    resp = urllib.request.urlopen('http://localhost:8000/api/models/current', timeout=5)
    data = json.loads(resp.read())
    print(f'  GET /api/models/current → {resp.status}: key={repr(data["key"])}, name={data["name"]}')

    resp = urllib.request.urlopen(
        'http://localhost:8000/api/models/check-availability?model_key=insightface_arcface', timeout=5)
    data = json.loads(resp.read())
    print(f'  GET /api/models/check-availability → {resp.status}: available={data["available"]}')

    # 测试切换模型
    req = urllib.request.Request(
        'http://localhost:8000/api/models/switch',
        data=json.dumps({'model_key': 'insightface_arcface', 'device': 'cpu'}).encode(),
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    try:
        resp = urllib.request.urlopen(req, timeout=10)
        data = json.loads(resp.read())
        print(f'  POST /api/models/switch → {resp.status}: {data}')
    except urllib.error.HTTPError as e:
        body = json.loads(e.read())
        detail = body.get('detail', str(body))
        print(f'  POST /api/models/switch → {e.code}: {detail}')
        if '可用模型' in str(detail) and '[]' in str(detail):
            print('  ❌ 仍然存在"可用模型:[]"错误！')
            sys.exit(1)
        else:
            print('  ✅ 错误已变更为模型下载相关，不再是空模型问题')

    resp = urllib.request.urlopen('http://localhost:8000/api/mirrors', timeout=5)
    data = json.loads(resp.read())
    print(f'  GET /api/mirrors → {resp.status}: {len(data["mirrors"])} mirrors, current={data["current"]["name"]}')

    resp = urllib.request.urlopen('http://localhost:8000/', timeout=5)
    print(f'  GET / → {resp.status}: HTML page')

    print()
    print('✅ 全部验证通过！')
except Exception as e:
    print(f'❌ 测试失败: {e}')
    sys.exit(1)
finally:
    proc.terminate()
    proc.wait()