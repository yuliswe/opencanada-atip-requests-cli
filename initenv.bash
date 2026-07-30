poetry env use python3
poetry install
poetry run nodeenv -n lts .nodevenv
(source .nodevenv/bin/activate && npm install)
