/* ===== 用户认证模块 ===== */
const Auth = (() => {
  const TOKEN_KEY = "pokepai_token";
  const USER_KEY = "pokepai_user";
  const EXPIRES_KEY = "pokepai_token_expires";
  const SESSION_KEY = "pokepai_session";
  const DB_NAME = "pokepai_auth_db";
  const DB_VERSION = 1;
  const USER_STORE = "users";
  const LOCAL_USERS_FALLBACK_KEY = "pokepai_local_users_v1";
  const PASSWORD_SALT = "_pokepai_salt_2026";
  const SESSION_DAYS = 7;
  const ALLOWED_AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
  const DEFAULT_AVATAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <rect width="100" height="100" fill="#d6bd92"/>
    <circle cx="50" cy="38" r="18" fill="#775f47"/>
    <ellipse cx="50" cy="82" rx="28" ry="22" fill="#775f47"/>
  </svg>`;
  const DEFAULT_AVATAR_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(DEFAULT_AVATAR_SVG)}`;
  let currentUser = null;
  let initPromise = null;
  let dbPromise = null;

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("本地数据库操作失败"));
    });
  }

  function openAuthDb() {
    if (!window.indexedDB) return Promise.resolve(null);
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(USER_STORE)) {
          db.createObjectStore(USER_STORE, { keyPath: "username" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("无法打开本地用户数据库"));
      request.onblocked = () => reject(new Error("本地用户数据库被其他页面占用，请关闭其他页面后重试"));
    }).catch(err => {
      dbPromise = null;
      throw err;
    });
    return dbPromise;
  }

  async function readFallbackUsers() {
    try {
      return JSON.parse(localStorage.getItem(LOCAL_USERS_FALLBACK_KEY) || "{}");
    } catch {
      return {};
    }
  }

  async function getStoredUser(username) {
    const db = await openAuthDb();
    if (!db) {
      const users = await readFallbackUsers();
      return users[username] || null;
    }
    const tx = db.transaction(USER_STORE, "readonly");
    const store = tx.objectStore(USER_STORE);
    return await requestToPromise(store.get(username));
  }

  async function saveStoredUser(userInfo) {
    const db = await openAuthDb();
    if (!db) {
      const users = await readFallbackUsers();
      users[userInfo.username] = userInfo;
      localStorage.setItem(LOCAL_USERS_FALLBACK_KEY, JSON.stringify(users));
      return;
    }
    const tx = db.transaction(USER_STORE, "readwrite");
    const store = tx.objectStore(USER_STORE);
    await requestToPromise(store.put(userInfo));
  }

  function getPublicUser(userInfo) {
    return {
      username: userInfo.username,
      nickname: userInfo.nickname,
      avatarUrl: userInfo.avatarUrl || DEFAULT_AVATAR_URL,
    };
  }

  async function hashPassword(password) {
    if (!window.crypto?.subtle) {
      throw new Error("当前浏览器环境不支持安全密码哈希，请通过 localhost 或 HTTPS 打开页面");
    }
    const encoder = new TextEncoder();
    const data = encoder.encode(password + PASSWORD_SALT);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  }

  function createToken() {
    const tokenBytes = new Uint8Array(32);
    if (window.crypto?.getRandomValues) {
      crypto.getRandomValues(tokenBytes);
      return Array.from(tokenBytes).map(b => b.toString(16).padStart(2, "0")).join("");
    }
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = event => resolve(event.target.result);
      reader.onerror = () => reject(reader.error || new Error("头像读取失败"));
      reader.readAsDataURL(file);
    });
  }

  function normalizeUsername(username) {
    return String(username || "").trim();
  }

  // 获取存储的 token（自动检查过期）
  function getToken() {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return null;
    const expires = localStorage.getItem(EXPIRES_KEY);
    if (expires && new Date(expires) < new Date()) {
      // token 已过期，清除并返回 null
      clearLogin();
      return null;
    }
    return token;
  }

  // 获取存储的用户信息
  function getUser() {
    try {
      const str = localStorage.getItem(USER_KEY);
      return str ? JSON.parse(str) : null;
    } catch {
      return null;
    }
  }

  function getSession() {
    try {
      const str = localStorage.getItem(SESSION_KEY);
      return str ? JSON.parse(str) : null;
    } catch {
      return null;
    }
  }

  // 保存登录信息（含过期时间）
  function saveLogin(token, user, expiresAt) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token, username: user.username, expiresAt }));
    if (expiresAt) {
      localStorage.setItem(EXPIRES_KEY, expiresAt);
    }
  }

  // 清除登录信息
  function clearLogin() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(EXPIRES_KEY);
    localStorage.removeItem(SESSION_KEY);
  }

  // 同步当前登录态给游戏主界面，避免 auth.js 和 app.js 抢着显示 setup
  function setCurrentUser(user) {
    currentUser = user || null;
    document.dispatchEvent(new CustomEvent("auth:change", { detail: { user: currentUser } }));
  }

  function getCurrentUser() {
    return currentUser;
  }

  // 注册：用户资料写入浏览器本地 IndexedDB，头像以 data URL 存储
  async function register(formData) {
    const username = normalizeUsername(formData.get("username"));
    const password = String(formData.get("password") || "");
    const nickname = String(formData.get("nickname") || "").trim();
    const avatarFile = formData.get("avatar");

    if (!username || !password || !nickname) {
      return { success: false, message: "用户名、密码和昵称不能为空" };
    }

    if (username.length < 3 || username.length > 20) {
      return { success: false, message: "用户名长度需在3-20个字符之间" };
    }

    if (password.length < 6) {
      return { success: false, message: "密码长度不能少于6位" };
    }

    const existingUser = await getStoredUser(username);
    if (existingUser) {
      return { success: false, message: "用户名已存在" };
    }

    const passwordHash = await hashPassword(password);
    let avatarUrl = DEFAULT_AVATAR_URL;
    if (avatarFile && avatarFile.size > 0) {
      if (avatarFile.size > 2 * 1024 * 1024) {
        return { success: false, message: "头像文件不能超过2MB" };
      }
      if (!ALLOWED_AVATAR_TYPES.has(avatarFile.type)) {
        return { success: false, message: "头像仅支持 JPG、PNG 或 WebP" };
      }
      avatarUrl = await readFileAsDataUrl(avatarFile);
    }

    const userInfo = {
      username,
      nickname,
      passwordHash,
      avatarUrl,
      createdAt: new Date().toISOString(),
      storage: "indexedDB",
    };
    await saveStoredUser(userInfo);

    return { success: true, message: "注册成功" };
  }

  // 登录：从本地 IndexedDB 查询用户并校验密码
  async function login(username, password) {
    const normalizedUsername = normalizeUsername(username);
    if (!normalizedUsername || !password) {
      return { success: false, message: "用户名和密码不能为空" };
    }

    const userInfo = await getStoredUser(normalizedUsername);
    if (!userInfo) {
      return { success: false, message: "用户名或密码错误" };
    }

    const passwordHash = await hashPassword(password);
    if (passwordHash !== userInfo.passwordHash) {
      return { success: false, message: "用户名或密码错误" };
    }

    const token = createToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const user = getPublicUser(userInfo);
    saveLogin(token, user, expiresAt);

    return {
      success: true,
      message: "登录成功",
      token,
      expiresAt,
      user,
    };
  }

  // 验证登录态：只校验本地 session，不再依赖远端接口
  async function checkAuth() {
    const token = getToken();
    const session = getSession();
    if (!token || !session || session.token !== token || !session.username) {
      clearLogin();
      return null;
    }
    if (session.expiresAt && new Date(session.expiresAt) < new Date()) {
      clearLogin();
      return null;
    }

    try {
      const userInfo = await getStoredUser(session.username);
      if (!userInfo) {
        clearLogin();
        return null;
      }
      const user = getPublicUser(userInfo);
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      return user;
    } catch {
      clearLogin();
      return null;
    }
  }

  function redirectToLogin() {
    clearLogin();
    renderUserBar(null);
    setCurrentUser(null);
    renderAuthUI();
    showAuthScreen();
  }

  // 登出
  function logout() {
    redirectToLogin();
  }

  // ===== UI 渲染 =====

  function showAuthScreen() {
    document.body.classList.add("auth-locked");
    document.body.classList.remove("auth-unlocked");
    document.getElementById("authScreen").classList.remove("hidden");
    document.getElementById("setup").classList.add("hidden");
    document.getElementById("game").classList.add("hidden");
  }

  function hideAuthScreen() {
    document.body.classList.remove("auth-locked");
    document.body.classList.add("auth-unlocked");
    document.getElementById("authScreen").classList.add("hidden");
  }

  // 渲染顶部用户信息栏
  function renderUserBar(user) {
    const bar = document.getElementById("userBar");
    if (!user) {
      bar.classList.add("hidden");
      return;
    }
    bar.classList.remove("hidden");
    bar.innerHTML = `
      <img class="user-avatar-sm" src="${user.avatarUrl || DEFAULT_AVATAR_URL}" alt="头像" />
      <span class="user-nick">${escapeHtml(user.nickname)}</span>
      <button id="logoutBtn" class="btn-sm">退出</button>
    `;
    document.getElementById("logoutBtn").addEventListener("click", logout);
  }

  // 渲染登录/注册界面
  function renderAuthUI() {
    const container = document.getElementById("authScreen");
    container.innerHTML = `
      <div class="auth-card">
        <div class="auth-brand">
          <p class="eyebrow">巫师三 · 昆特牌</p>
          <h1>来盘昆特牌吧</h1>
          <p>请先登录，账号会保存在当前浏览器本地数据库中。</p>
        </div>
        <div class="auth-tabs">
          <button class="auth-tab active" data-tab="login">登录</button>
          <button class="auth-tab" data-tab="register">注册</button>
        </div>

        <form id="loginForm" class="auth-form">
          <div class="form-group">
            <label for="loginUsername">账号</label>
            <input type="text" id="loginUsername" placeholder="请输入账号" autocomplete="username" required minlength="3" maxlength="20" />
          </div>
          <div class="form-group">
            <label for="loginPassword">密码</label>
            <input type="password" id="loginPassword" placeholder="请输入密码" autocomplete="current-password" required minlength="6" />
          </div>
          <p id="loginError" class="auth-error hidden"></p>
          <button type="submit" class="primary auth-submit">登录</button>
        </form>

        <form id="registerForm" class="auth-form hidden">
          <div class="form-group">
            <label for="regUsername">账号</label>
            <input type="text" id="regUsername" placeholder="3-20个字符" autocomplete="username" required minlength="3" maxlength="20" />
          </div>
          <div class="form-group">
            <label for="regPassword">密码</label>
            <input type="password" id="regPassword" placeholder="至少6位" autocomplete="new-password" required minlength="6" />
          </div>
          <div class="form-group">
            <label for="regNickname">昵称</label>
            <input type="text" id="regNickname" placeholder="游戏内显示名称" required maxlength="16" />
          </div>
          <div class="form-group">
            <label>头像</label>
            <div class="avatar-upload">
              <div class="avatar-preview" id="avatarPreview">
                <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
                  <rect width="100" height="100" fill="#d6bd92"/>
                  <circle cx="50" cy="38" r="18" fill="#775f47"/>
                  <ellipse cx="50" cy="82" rx="28" ry="22" fill="#775f47"/>
                </svg>
              </div>
              <div class="avatar-actions">
                <button type="button" id="avatarBtn">选择图片</button>
                <input type="file" id="avatarInput" accept="image/jpeg,image/png,image/webp" hidden />
                <p class="hint">支持 JPG/PNG/WebP，不超过 2MB</p>
              </div>
            </div>
          </div>
          <p id="registerError" class="auth-error hidden"></p>
          <button type="submit" class="primary auth-submit">注册</button>
        </form>

        <p class="auth-skip">
          <span class="auth-hint">登录后即可开始游戏，本地账号不会同步到其他浏览器或设备</span>
        </p>
      </div>
    `;

    // 绑定事件
    bindAuthEvents();
  }

  function bindAuthEvents() {
    // Tab 切换
    const tabs = document.querySelectorAll(".auth-tab");
    tabs.forEach(tab => {
      tab.addEventListener("click", () => {
        tabs.forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        const isLogin = tab.dataset.tab === "login";
        document.getElementById("loginForm").classList.toggle("hidden", !isLogin);
        document.getElementById("registerForm").classList.toggle("hidden", isLogin);
      });
    });

    // 头像上传
    document.getElementById("avatarBtn").addEventListener("click", () => {
      document.getElementById("avatarInput").click();
    });
    document.getElementById("avatarInput").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      hideError("registerError");
      if (file.size > 2 * 1024 * 1024) {
        showError("registerError", "图片不能超过 2MB");
        e.target.value = "";
        return;
      }
      if (!ALLOWED_AVATAR_TYPES.has(file.type)) {
        showError("registerError", "头像仅支持 JPG、PNG 或 WebP");
        e.target.value = "";
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        document.getElementById("avatarPreview").innerHTML = `<img src="${ev.target.result}" alt="头像预览" />`;
      };
      reader.readAsDataURL(file);
    });

    // 登录表单
    document.getElementById("loginForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector("button[type=submit]");
      btn.disabled = true;
      btn.textContent = "登录中...";
      hideError("loginError");

      const username = document.getElementById("loginUsername").value.trim();
      const password = document.getElementById("loginPassword").value;

      try {
        const result = await login(username, password);
        if (result.success) {
          renderUserBar(result.user);
          hideAuthScreen();
          setCurrentUser(result.user);
        } else {
          showError("loginError", result.message);
        }
      } catch (err) {
        showError("loginError", err.message || "登录失败，请重试");
      }
      btn.disabled = false;
      btn.textContent = "登录";
    });

    // 注册表单
    document.getElementById("registerForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector("button[type=submit]");
      btn.disabled = true;
      btn.textContent = "注册中...";
      hideError("registerError");

      const formData = new FormData();
      formData.append("username", document.getElementById("regUsername").value.trim());
      formData.append("password", document.getElementById("regPassword").value);
      formData.append("nickname", document.getElementById("regNickname").value.trim());

      const avatarFile = document.getElementById("avatarInput").files[0];
      if (avatarFile) {
        formData.append("avatar", avatarFile);
      }

      try {
        const result = await register(formData);
        if (result.success) {
          // 注册成功后自动登录
          const loginResult = await login(
            document.getElementById("regUsername").value.trim(),
            document.getElementById("regPassword").value
          );
          if (loginResult.success) {
            renderUserBar(loginResult.user);
            hideAuthScreen();
            setCurrentUser(loginResult.user);
          } else {
            showError("registerError", "注册成功，请切换到登录页登录");
          }
        } else {
          showError("registerError", result.message);
        }
      } catch (err) {
        showError("registerError", err.message || "注册失败，请重试");
      }
      btn.disabled = false;
      btn.textContent = "注册";
    });

  }

  // 工具函数
  function showError(id, msg) {
    const el = document.getElementById(id);
    el.textContent = msg;
    el.classList.remove("hidden");
  }

  function hideError(id) {
    document.getElementById(id).classList.add("hidden");
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ===== 初始化入口 =====
  async function init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      renderAuthUI();
      const user = await checkAuth();
      if (user) {
        renderUserBar(user);
        hideAuthScreen();
        setCurrentUser(user);
      } else {
        renderUserBar(null);
        setCurrentUser(null);
        showAuthScreen();
      }
      return user;
    })();
    return initPromise;
  }

  function whenReady() {
    return initPromise || init();
  }

  return { init, whenReady, getToken, getUser, getCurrentUser, logout, redirectToLogin, checkAuth };
})();

// 页面加载后初始化认证模块
document.addEventListener("DOMContentLoaded", () => {
  // 先让 Auth 决定显示哪个界面
  Auth.init();
});
