#!/usr/bin/env python3
"""
王國紀元兌換碼工具 — Coupon Redemption Tool
支援載入 monarch（主公名稱）與 serialcode（虛寶序號）兩個 txt 檔案，
提供「一對一模式」與「共用模式」兩種執行方式。
"""

import tkinter as tk
from tkinter import ttk, filedialog, messagebox, scrolledtext
import threading
import queue
import time
import random
import json
import os
import sys
import pickle
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import quote
from dataclasses import dataclass, field
from enum import Enum, auto

# ── Try to import requests, fallback to urllib ──
try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False

# ── Constants ──
API_URL = "https://coupon.kingdom-story.com/register-coupon"
SERVER_ID = "10"
DEFAULT_WORKERS = 5   # concurrent threads
MAX_WORKERS_LIMIT = 15
REQUEST_TIMEOUT = 15  # seconds
RETRY_DELAY_BASE = 2.0  # base retry delay in seconds
JITTER_MIN = 0.1        # random delay min
JITTER_MAX = 0.8        # random delay max
MAX_RETRIES = 2         # auto-retry on network error
CONFIG_FILE = Path.home() / ".coupon_tool_config.pkl"
RECENT_DIR = Path.home()

# ── Error code mapping ──
CODE_MESSAGES = {
    0:   "✅ 成功 — 道具已發送",
    11:  "❌ 語言錯誤",
    21:  "❌ 服務器錯誤",
    31:  "❌ 主公名稱錯誤",
    32:  "❌ 該帳戶已退出",
    72:  "⏭️ 已使用過的虛寶序號",
    81:  "❌ 無更多兌換碼",
    82:  "❌ 兌換碼過期",
    84:  "❌ 錯誤的虛寶序號",
    98:  "❌ 請從兌換頁面訪問",
    99:  "❌ 其他錯誤",
}
NETWORK_ERRORS = {
    "timeout":   "⏱️ 請求超時",
    "connection": "🔌 連線失敗",
    "http":      "🌐 HTTP 錯誤",
    "general":   "💥 網路錯誤",
}


class TaskStatus(Enum):
    PENDING    = auto()
    RUNNING    = auto()
    SUCCESS    = auto()
    FAILED     = auto()
    SKIPPED    = auto()
    RETRYING   = auto()


@dataclass
class CouponTask:
    """單一兌換任務"""
    monarch: str
    serialcode: str
    status: TaskStatus = TaskStatus.PENDING
    message: str = ""
    row_idx: int = -1

    @property
    def status_text(self) -> str:
        icons = {
            TaskStatus.PENDING:  "⏳ 等待中",
            TaskStatus.RUNNING:  "🔄 執行中",
            TaskStatus.SUCCESS:  "✅ 成功",
            TaskStatus.FAILED:   "❌ 失敗",
            TaskStatus.SKIPPED:  "⏭️ 已跳過",
            TaskStatus.RETRYING: "🔁 重試中",
        }
        return icons.get(self.status, "❓")


def send_request(monarch: str, serialcode: str, timeout=REQUEST_TIMEOUT) -> dict:
    """Send one coupon registration request with auto-retry on network errors."""
    last_error = None
    for attempt in range(MAX_RETRIES + 1):
        if attempt > 0:
            delay = RETRY_DELAY_BASE * (2 ** (attempt - 1)) + random.uniform(JITTER_MIN, JITTER_MAX)
            time.sleep(delay)

        result = _do_request(monarch, serialcode, timeout)
        if result.get("success", False):
            return result
        # Network errors → retry; API errors (success=True with code≠0) → don't retry
        if "error" in result and result["error"] != "general":
            last_error = result
            continue
        return result
    return last_error or {"success": False, "error": "general", "detail": "Max retries exhausted"}


def _do_request(monarch: str, serialcode: str, timeout) -> dict:
    """Raw single request."""
    body = f"server={SERVER_ID}&monarch={quote(monarch)}&serialcode={serialcode}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        "Origin": "https://coupon.kingdom-story.com",
        "Referer": "https://coupon.kingdom-story.com/lang/zh-TW",
        "Accept": "*/*",
        "Accept-Language": "zh-TW,zh;q=0.9",
    }

    if HAS_REQUESTS:
        try:
            resp = requests.post(API_URL, data=body, headers=headers, timeout=timeout)
            return {"success": True, "http_code": resp.status_code, "body": resp.text}
        except requests.Timeout:
            return {"success": False, "error": "timeout"}
        except requests.ConnectionError:
            return {"success": False, "error": "connection"}
        except requests.RequestException as e:
            return {"success": False, "error": "general", "detail": str(e)}
    else:
        # ── urllib fallback ──
        import urllib.request
        import urllib.error
        try:
            data = body.encode("utf-8")
            req = urllib.request.Request(API_URL, data=data, headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return {"success": True, "http_code": resp.status, "body": resp.read().decode("utf-8")}
        except urllib.error.URLError as e:
            return {"success": False, "error": "general", "detail": str(e)}
        except Exception as e:
            return {"success": False, "error": "general", "detail": str(e)}


def parse_response(result: dict) -> tuple[bool, str]:
    """Parse API response => (is_success, human_message)."""
    if not result["success"]:
        return False, NETWORK_ERRORS.get(result.get("error", "general"),
                                         f"💥 {result.get('detail', '未知錯誤')}")

    try:
        data = json.loads(result["body"])
        code = data.get("code", 99)
    except json.JSONDecodeError:
        return False, "❌ 解析回應失敗"

    if code == 0:
        return True, CODE_MESSAGES[0]
    return False, CODE_MESSAGES.get(code, f"❌ 未知代碼 {code}")


# ═══════════════════════════════════════════
#  GUI Application
# ═══════════════════════════════════════════

class CouponApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("王國紀元 兌換碼工具 v2.1")
        self.root.geometry("960x680")
        self.root.minsize(820, 520)

        # ── Load config ──
        self._config = self._load_config()
        self._last_dir = self._config.get("last_dir", str(RECENT_DIR))

        # ── Style ──
        style = ttk.Style()
        style.theme_use("clam")
        style.configure("Title.TLabel", font=("Microsoft JhengHei", 14, "bold"))
        style.configure("Heading.TLabel", font=("Microsoft JhengHei", 9, "bold"))
        style.configure("Success.TLabel", foreground="#0a0")
        style.configure("Failed.TLabel", foreground="#c00")
        style.configure("Big.TButton", font=("Microsoft JhengHei", 12, "bold"), padding=8)

        # ── Data ──
        self.monarchs: list[str] = []
        self.serialcodes: list[str] = []
        self.tasks: list[CouponTask] = []
        self.mode = tk.StringVar(value="one2one")
        self.running = False
        self.stop_flag = threading.Event()
        self._executor: ThreadPoolExecutor | None = None
        self._result_queue = queue.Queue()

        # ── Restore config ──
        if "mode" in self._config:
            self.mode.set(self._config["mode"])
        worker_cfg = self._config.get("worker_count", DEFAULT_WORKERS)

        # ── Build UI ──
        self._build_file_section()
        self._build_mode_section()
        self._build_table()
        self._build_controls()
        self._build_log()

        # Poll queue for UI updates
        self._poll_queue()

    # ── UI Sections ──

    def _build_file_section(self):
        frm = ttk.LabelFrame(self.root, text="📁 匯入檔案", padding=10)
        frm.pack(fill=tk.X, padx=12, pady=(10, 4))

        # Row 0: Monarch
        ttk.Label(frm, text="Monarch 主公名稱:").grid(row=0, column=0, sticky=tk.W, padx=(0, 6))
        self.lbl_monarch = ttk.Label(frm, text="未載入", foreground="gray")
        self.lbl_monarch.grid(row=0, column=1, sticky=tk.W, padx=6)
        ttk.Button(frm, text="📂 選擇", command=self._load_monarch).grid(row=0, column=2, padx=4)
        ttk.Button(frm, text="✏️ 編輯", command=self._edit_monarch).grid(row=0, column=3, padx=4)

        ttk.Label(frm, text=f"範例格式: 每行一個主公名，如 無雙戰帝").grid(row=0, column=4, padx=12, sticky=tk.W)

        # Row 1: Serialcode
        ttk.Label(frm, text="Serialcode 序號:").grid(row=1, column=0, sticky=tk.W, padx=(0, 6), pady=(8, 0))
        self.lbl_serial = ttk.Label(frm, text="未載入", foreground="gray")
        self.lbl_serial.grid(row=1, column=1, sticky=tk.W, padx=6, pady=(8, 0))
        ttk.Button(frm, text="📂 選擇", command=self._load_serial).grid(row=1, column=2, padx=4, pady=(8, 0))
        ttk.Button(frm, text="✏️ 編輯", command=self._edit_serial).grid(row=1, column=3, padx=4, pady=(8, 0))

        ttk.Label(frm, text=f"範例格式: 每行一個序號，如 sunny266").grid(row=1, column=4, padx=12, sticky=tk.W, pady=(8, 0))

    def _build_mode_section(self):
        frm = ttk.LabelFrame(self.root, text="⚙️ 執行模式", padding=10)
        frm.pack(fill=tk.X, padx=12, pady=4)

        ttk.Radiobutton(frm, text="一對一模式 — 1個主公對應1個序號（依序配對）",
                        variable=self.mode, value="one2one",
                        command=self._on_mode_change).pack(anchor=tk.W)
        ttk.Label(frm, text="   例: 主公A→序號1, 主公B→序號2, …", foreground="gray").pack(anchor=tk.W, padx=(24, 0))

        ttk.Radiobutton(frm, text="共用模式 — 所有主公共用一個序號，用完再換下一個",
                        variable=self.mode, value="shared",
                        command=self._on_mode_change).pack(anchor=tk.W)
        ttk.Label(frm, text="   例: 主公A→序號1, 主公B→序號1, …, 主公A→序號2, …", foreground="gray").pack(anchor=tk.W, padx=(24, 0))

    def _build_table(self):
        frm = ttk.LabelFrame(self.root, text="📋 任務列表", padding=8)
        frm.pack(fill=tk.BOTH, expand=True, padx=12, pady=4)

        # Treeview
        cols = ("#", "monarch", "serialcode", "status", "message")
        self.tree = ttk.Treeview(frm, columns=cols, show="headings", height=8)
        self.tree.heading("#", text="#")
        self.tree.heading("monarch", text="👤 Monarch（主公）")
        self.tree.heading("serialcode", text="🎫 Serialcode（序號）")
        self.tree.heading("status", text="狀態")
        self.tree.heading("message", text="訊息")

        self.tree.column("#", width=40, anchor=tk.CENTER)
        self.tree.column("monarch", width=170)
        self.tree.column("serialcode", width=150)
        self.tree.column("status", width=100, anchor=tk.CENTER)
        self.tree.column("message", width=320)

        # Scrollbar
        sb = ttk.Scrollbar(frm, orient=tk.VERTICAL, command=self.tree.yview)
        self.tree.configure(yscrollcommand=sb.set)

        self.tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        sb.pack(side=tk.RIGHT, fill=tk.Y)

        # Context menu for retry
        self._ctx_menu = tk.Menu(self.root, tearoff=0)
        self._ctx_menu.add_command(label="🔁 重試選中項目", command=self._retry_selected)
        self._ctx_menu.add_command(label="📋 複製選中主公名", command=self._copy_monarch)
        self._ctx_menu.add_separator()
        self._ctx_menu.add_command(label="🔁 重試全部失敗項", command=self._retry_all_failed)
        self.tree.bind("<Button-3>", self._on_right_click)
        self.tree.bind("<Button-2>", self._on_right_click)  # macOS

    def _build_controls(self):
        frm = ttk.Frame(self.root, padding=8)
        frm.pack(fill=tk.X, padx=12, pady=(2, 4))

        # Progress
        self.pb = ttk.Progressbar(frm, mode="determinate", length=280)
        self.pb.pack(side=tk.LEFT, padx=(0, 10))
        self.lbl_progress = ttk.Label(frm, text="就緒")
        self.lbl_progress.pack(side=tk.LEFT, padx=4)

        # Stats
        self.lbl_stats = ttk.Label(frm, text="")
        self.lbl_stats.pack(side=tk.RIGHT, padx=8)

        # Buttons
        self.btn_run = ttk.Button(frm, text="▶️ 開始執行", command=self._start,
                                  style="Big.TButton")
        self.btn_run.pack(side=tk.RIGHT, padx=4)
        self.btn_stop = ttk.Button(frm, text="⏹️ 停止", command=self._stop, state=tk.DISABLED)
        self.btn_stop.pack(side=tk.RIGHT, padx=4)
        self.btn_export = ttk.Button(frm, text="📤 匯出結果", command=self._export)
        self.btn_export.pack(side=tk.RIGHT, padx=4)

        # Worker count
        ttk.Label(frm, text="併發:").pack(side=tk.RIGHT, padx=(12, 2))
        saved_workers = self._config.get("worker_count", DEFAULT_WORKERS)
        self.worker_count = tk.IntVar(value=saved_workers)
        spin = ttk.Spinbox(frm, from_=1, to=MAX_WORKERS_LIMIT, textvariable=self.worker_count,
                           width=3, justify=tk.CENTER)
        spin.pack(side=tk.RIGHT)

    def _build_log(self):
        frm = ttk.LabelFrame(self.root, text="📜 執行日誌", padding=8)
        frm.pack(fill=tk.BOTH, padx=12, pady=(2, 10))

        log_frame = ttk.Frame(frm)
        log_frame.pack(fill=tk.BOTH, expand=True)

        self.log = scrolledtext.ScrolledText(log_frame, height=6, wrap=tk.WORD,
                                             font=("Consolas", 9))
        self.log.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        # Clear button
        btn_frame = ttk.Frame(frm)
        btn_frame.pack(fill=tk.X, pady=(4, 0))
        ttk.Button(btn_frame, text="🗑️ 清除日誌", command=self._clear_log).pack(side=tk.RIGHT)
        self.lbl_log_count = ttk.Label(btn_frame, text="", foreground="gray")
        self.lbl_log_count.pack(side=tk.LEFT)

    # ── File operations ──

    def _load_monarch(self):
        path = filedialog.askopenfilename(
            title="選擇 Monarch 主公名稱檔案",
            filetypes=[("Text files", "*.txt"), ("All files", "*.*")],
            initialdir=self._last_dir
        )
        if path:
            self._last_dir = os.path.dirname(path)
            self._save_config()
            raw = self._read_lines(path)
            deduped = []
            seen_m = set()
            for ln in raw:
                if ln not in seen_m:
                    seen_m.add(ln)
                    deduped.append(ln)
            self.monarchs = deduped
            dedup_msg = f" (已去重 {len(raw) - len(deduped)} 筆)" if len(raw) != len(deduped) else ""
            self.lbl_monarch.config(text=f"{path} ({len(self.monarchs)} 筆)", foreground="black")
            self._log(f"📂 載入 monarch: {len(self.monarchs)} 筆{dedup_msg}")

    def _load_serial(self):
        path = filedialog.askopenfilename(
            title="選擇 Serialcode 序號檔案",
            filetypes=[("Text files", "*.txt"), ("All files", "*.*")],
            initialdir=self._last_dir
        )
        if path:
            self._last_dir = os.path.dirname(path)
            self._save_config()
            self.serialcodes = self._read_lines(path)
            self.lbl_serial.config(text=f"{path} ({len(self.serialcodes)} 筆)", foreground="black")
            self._log(f"📂 載入 serialcode: {len(self.serialcodes)} 筆")

    def _edit_monarch(self):
        self._open_editor("monarch.txt", self.monarchs, self._on_monarch_edited)

    def _edit_serial(self):
        self._open_editor("serialcode.txt", self.serialcodes, self._on_serial_edited)

    def _on_monarch_edited(self, lines):
        self.monarchs = lines
        self.lbl_monarch.config(text=f"手動編輯 ({len(self.monarchs)} 筆)", foreground="black")
        self._log(f"✏️ 編輯 monarch: {len(self.monarchs)} 筆")

    def _on_serial_edited(self, lines):
        self.serialcodes = lines
        self.lbl_serial.config(text=f"手動編輯 ({len(self.serialcodes)} 筆)", foreground="black")
        self._log(f"✏️ 編輯 serialcode: {len(self.serialcodes)} 筆")

    @staticmethod
    def _read_lines(path: str) -> list[str]:
        with open(path, "r", encoding="utf-8") as f:
            encoded = f.read()
        return [ln.strip() for ln in encoded.splitlines() if ln.strip()]

    # ── Generation ──

    def _generate_tasks(self):
        """根据模式生成任务列表，自動移除重複的 (monarch, serialcode) 組合。"""
        self.tasks.clear()
        tasks = []
        seen: set[tuple[str, str]] = set()
        dupes = 0

        if self.mode.get() == "one2one":
            limit = max(len(self.monarchs), len(self.serialcodes))
            for i in range(limit):
                m = self.monarchs[i] if i < len(self.monarchs) else ""
                s = self.serialcodes[i] if i < len(self.serialcodes) else ""
                if m and s:
                    pair = (m, s)
                    if pair in seen:
                        dupes += 1
                        continue
                    seen.add(pair)
                    tasks.append(CouponTask(monarch=m, serialcode=s, row_idx=len(tasks)))
        else:
            for s in self.serialcodes:
                for m in self.monarchs:
                    pair = (m, s)
                    if pair in seen:
                        dupes += 1
                        continue
                    seen.add(pair)
                    tasks.append(CouponTask(monarch=m, serialcode=s, row_idx=len(tasks)))

        self.tasks = tasks
        log = f"📋 生成 {len(tasks)} 個任務 (模式: {'一對一' if self.mode.get() == 'one2one' else '共用'})"
        if dupes:
            log += f" — 已自動移除 {dupes} 個重複組合"
        self._log(log)

    def _populate_table(self):
        self.tree.delete(*self.tree.get_children())
        for i, t in enumerate(self.tasks):
            t.row_idx = i
            self.tree.insert("", tk.END, iid=str(i), values=(
                i + 1, t.monarch, t.serialcode, t.status_text, t.message
            ))

    def _on_mode_change(self):
        if self.monarchs and self.serialcodes:
            self._generate_tasks()
            self._populate_table()
            self._update_stats()

    # ── Execution ──

    def _start(self):
        if not self.monarchs:
            messagebox.showwarning("缺少資料", "請先載入 Monarch 主公名稱檔案。")
            return
        if not self.serialcodes:
            messagebox.showwarning("缺少資料", "請先載入 Serialcode 序號檔案。")
            return

        # Reset tasks that were finished, keep pending
        pending = [t for t in self.tasks if t.status != TaskStatus.SUCCESS]
        if not pending:
            if messagebox.askyesno("全部已完成", "所有任務已完成。要重新執行全部嗎？"):
                for t in self.tasks:
                    t.status = TaskStatus.PENDING
                    t.message = ""
            else:
                return

        self._generate_tasks()
        self._populate_table()

        self.running = True
        self.stop_flag.clear()
        self.btn_run.config(state=tk.DISABLED)
        self.btn_stop.config(state=tk.NORMAL)

        pending_tasks = [t for t in self.tasks if t.status == TaskStatus.PENDING]
        self.pb["maximum"] = len(pending_tasks)
        self.pb["value"] = 0

        self._log(f"🚀 開始執行 {len(pending_tasks)} 個任務 (併發數: {self.worker_count.get()})")

        # Run in background thread
        thread = threading.Thread(target=self._run_tasks, args=(pending_tasks,), daemon=True)
        thread.start()

    def _stop(self):
        self.stop_flag.set()
        self._log("⏹️ 使用者要求停止…")
        if self._executor:
            self._executor.shutdown(wait=False, cancel_futures=True)
        self._execution_done()

    def _run_tasks(self, pending_tasks: list[CouponTask]):
        """Background executor with jitter to spread requests."""
        n_workers = self.worker_count.get()
        self._executor = ThreadPoolExecutor(max_workers=n_workers)

        def do_one(task: CouponTask):
            if self.stop_flag.is_set():
                task.status = TaskStatus.SKIPPED
                task.message = "已取消"
                self._result_queue.put(task)
                return

            # Small random jitter to avoid thundering herd
            time.sleep(random.uniform(0.05, 0.3))

            task.status = TaskStatus.RUNNING
            self._result_queue.put(task)  # update UI

            result = send_request(task.monarch, task.serialcode)
            ok, msg = parse_response(result)

            task.status = TaskStatus.SUCCESS if ok else TaskStatus.FAILED
            task.message = msg
            self._result_queue.put(task)

        futures = []
        for task in pending_tasks:
            if self.stop_flag.is_set():
                break
            futures.append(self._executor.submit(do_one, task))

        for _ in as_completed(futures):
            pass  # results handled via queue

        self._executor.shutdown(wait=True)
        self._result_queue.put("DONE")

    def _poll_queue(self):
        """Poll the result queue and update UI."""
        completed = 0
        try:
            while True:
                item = self._result_queue.get_nowait()
                if item == "DONE":
                    self._execution_done()
                    return
                if isinstance(item, CouponTask):
                    completed += 1
                    self._update_task_row(item)
                    self.pb["value"] = completed
                    self._update_stats()
        except queue.Empty:
            pass
        self.root.after(80, self._poll_queue)

    def _update_task_row(self, task: CouponTask):
        iid = str(task.row_idx)
        if self.tree.exists(iid):
            self.tree.item(iid, values=(
                task.row_idx + 1, task.monarch, task.serialcode,
                task.status_text, task.message
            ))

    def _execution_done(self):
        self.running = False
        self.btn_run.config(state=tk.NORMAL)
        self.btn_stop.config(state=tk.DISABLED)
        self._update_stats()
        successes = sum(1 for t in self.tasks if t.status == TaskStatus.SUCCESS)
        failed = sum(1 for t in self.tasks if t.status == TaskStatus.FAILED)
        self._log(f"🏁 執行完畢 — 成功: {successes}, 失敗: {failed}")

    def _update_stats(self):
        total = len(self.tasks)
        success = sum(1 for t in self.tasks if t.status == TaskStatus.SUCCESS)
        failed = sum(1 for t in self.tasks if t.status == TaskStatus.FAILED)
        pending = sum(1 for t in self.tasks if t.status == TaskStatus.PENDING)
        self.lbl_stats.config(text=f"共 {total} | ✅ {success} | ❌ {failed} | ⏳ {pending}")

    # ── Retry ──

    def _retry_selected(self):
        selection = self.tree.selection()
        if not selection:
            return
        tasks_to_retry = [self.tasks[int(iid)] for iid in selection]
        self._retry_tasks(tasks_to_retry)

    def _retry_all_failed(self):
        failed_tasks = [t for t in self.tasks if t.status == TaskStatus.FAILED]
        if not failed_tasks:
            messagebox.showinfo("無失敗項", "沒有需要重試的失敗任務。")
            return
        self._retry_tasks(failed_tasks)

    def _retry_tasks(self, tasks_to_retry: list[CouponTask]):
        if self.running:
            messagebox.showwarning("執行中", "請先等待當前任務完成或停止後再重試。")
            return

        for t in tasks_to_retry:
            t.status = TaskStatus.PENDING
            t.message = ""
            self._update_task_row(t)

        self._log(f"🔁 準備重試 {len(tasks_to_retry)} 個任務")

        # Run them
        self.running = True
        self.stop_flag.clear()
        self.btn_run.config(state=tk.DISABLED)
        self.btn_stop.config(state=tk.NORMAL)
        self.pb["maximum"] = len(tasks_to_retry)
        self.pb["value"] = 0

        thread = threading.Thread(target=self._run_tasks, args=(tasks_to_retry,), daemon=True)
        thread.start()

    # ── Export ──

    def _export(self):
        if not self.tasks:
            return
        path = filedialog.asksaveasfilename(
            defaultextension=".txt",
            filetypes=[("Text files", "*.txt"), ("CSV", "*.csv"), ("All files", "*.*")]
        )
        if not path:
            return
        try:
            with open(path, "w", encoding="utf-8") as f:
                f.write("Monarch\tSerialcode\tStatus\tMessage\n")
                for t in self.tasks:
                    f.write(f"{t.monarch}\t{t.serialcode}\t{t.status.name}\t{t.message}\n")
            self._log(f"📤 已匯出至 {path}")
            messagebox.showinfo("匯出成功", f"結果已匯出至:\n{path}")
        except Exception as e:
            messagebox.showerror("匯出失敗", str(e))

    # ── Context menu ──

    def _on_right_click(self, event):
        iid = self.tree.identify_row(event.y)
        if iid:
            self.tree.selection_set(iid)
            self._ctx_menu.tk_popup(event.x_root, event.y_root)

    def _copy_monarch(self):
        sel = self.tree.selection()
        if sel:
            monarch = self.tasks[int(sel[0])].monarch
            self.root.clipboard_clear()
            self.root.clipboard_append(monarch)
            self._log(f"📋 已複製: {monarch}")

    # ── Log ──

    def _log(self, msg: str):
        ts = time.strftime("%H:%M:%S")
        self.log.insert(tk.END, f"[{ts}] {msg}\n")
        self.log.see(tk.END)
        self._update_log_count()

    def _clear_log(self):
        self.log.delete("1.0", tk.END)
        self._update_log_count()

    def _update_log_count(self):
        lines = int(self.log.index("end-1c").split(".")[0]) - 1
        self.lbl_log_count.config(text=f"共 {max(0, lines)} 行")

    # ── Config persistence ──

    def _load_config(self) -> dict:
        try:
            if CONFIG_FILE.exists():
                with open(CONFIG_FILE, "rb") as f:
                    return pickle.load(f)
        except Exception:
            pass
        return {}

    def _save_config(self):
        self._config["last_dir"] = self._last_dir
        self._config["worker_count"] = self.worker_count.get()
        self._config["mode"] = self.mode.get()
        try:
            with open(CONFIG_FILE, "wb") as f:
                pickle.dump(self._config, f)
        except Exception:
            pass

    def _on_close(self):
        self._save_config()
        self.root.destroy()

    # ── Editor Window ──

    def _open_editor(self, title, current_lines, callback):
        win = tk.Toplevel(self.root)
        win.title(f"編輯 {title}")
        win.geometry("500x400")
        win.transient(self.root)
        win.grab_set()

        txt = scrolledtext.ScrolledText(win, font=("Consolas", 11), wrap=tk.WORD)
        txt.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)
        txt.insert("1.0", "\n".join(current_lines))

        def save():
            lines = [ln.strip() for ln in txt.get("1.0", tk.END).splitlines() if ln.strip()]
            callback(lines)
            win.destroy()

        btn_frame = ttk.Frame(win)
        btn_frame.pack(fill=tk.X, padx=10, pady=(0, 10))
        ttk.Button(btn_frame, text="儲存", command=save).pack(side=tk.RIGHT, padx=4)
        ttk.Button(btn_frame, text="取消", command=win.destroy).pack(side=tk.RIGHT, padx=4)


def main():
    root = tk.Tk()
    app = CouponApp(root)
    root.protocol("WM_DELETE_WINDOW", app._on_close)
    root.mainloop()


if __name__ == "__main__":
    main()
