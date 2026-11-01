"""Self-hosted open-weight LLM for iDriveMzansi, served with vLLM on a Modal GPU.

Deploy with: modal deploy infra/modal/mzansidrive_llm.py
Create Modal secret ``mzansidrive-llm`` with LLM_API_KEY (the same value is given to mzansidrive-ai).
The server is OpenAI-compatible at <modal url>/v1 and requires the bearer key.
"""
import os
import subprocess

import modal

MODEL_NAME = os.environ.get("LLM_MODEL", "Qwen/Qwen2.5-7B-Instruct")
VLLM_PORT = 8000
MINUTES = 60

vllm_image = (
    modal.Image.from_registry("nvidia/cuda:12.9.0-devel-ubuntu22.04", add_python="3.12")
    .entrypoint([])
    .uv_pip_install("vllm==0.21.0")
)
hf_cache_vol = modal.Volume.from_name("huggingface-cache", create_if_missing=True)
vllm_cache_vol = modal.Volume.from_name("vllm-cache", create_if_missing=True)

app = modal.App("mzansidrive-llm")


@app.cls(
    image=vllm_image,
    gpu="A10G",
    secrets=[modal.Secret.from_name("mzansidrive-llm")],
    volumes={"/root/.cache/huggingface": hf_cache_vol, "/root/.cache/vllm": vllm_cache_vol},
    scaledown_window=5 * MINUTES,
    timeout=10 * MINUTES,
)
@modal.concurrent(max_inputs=8)
class Llm:
    @modal.enter()
    def start(self):
        self.process = subprocess.Popen([
            "vllm", "serve", MODEL_NAME,
            "--served-model-name", MODEL_NAME,
            "--host", "0.0.0.0", "--port", str(VLLM_PORT),
            "--max-model-len", "8192",
            "--gpu-memory-utilization", "0.90",
            "--api-key", os.environ["LLM_API_KEY"],
        ])

    @modal.web_server(port=VLLM_PORT, startup_timeout=10 * MINUTES)
    def serve(self):
        pass

    @modal.exit()
    def stop(self):
        self.process.terminate()
