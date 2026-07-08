// 登录接口：POST /api/auth/login
// 接收 JSON：{ username, password }

export async function onRequestPost({ request }) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json; charset=UTF-8",
  };

  try {
    const { username, password } = await request.json();

    if (!username || !password) {
      return new Response(
        JSON.stringify({ success: false, message: "用户名和密码不能为空" }),
        { status: 400, headers: corsHeaders }
      );
    }

    // 查询用户
    const userStr = await users_kv.get(`user:${username}`);
    if (!userStr) {
      return new Response(
        JSON.stringify({ success: false, message: "用户名或密码错误" }),
        { status: 401, headers: corsHeaders }
      );
    }

    const userInfo = JSON.parse(userStr);

    // 验证密码
    const encoder = new TextEncoder();
    const data = encoder.encode(password + "_pokepai_salt_2026");
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const passwordHash = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");

    if (passwordHash !== userInfo.passwordHash) {
      return new Response(
        JSON.stringify({ success: false, message: "用户名或密码错误" }),
        { status: 401, headers: corsHeaders }
      );
    }

    // 生成 session token
    const tokenBytes = new Uint8Array(32);
    crypto.getRandomValues(tokenBytes);
    const token = Array.from(tokenBytes).map(b => b.toString(16).padStart(2, "0")).join("");

    // 存储 session（7天有效）
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const session = {
      username: userInfo.username,
      nickname: userInfo.nickname,
      avatarUrl: userInfo.avatarUrl,
      createdAt: now.toISOString(),
      expiresAt,
    };
    // KV expirationTtl: 7天 = 604800秒
    await users_kv.put(`session:${token}`, JSON.stringify(session), { expirationTtl: 604800 });

    return new Response(
      JSON.stringify({
        success: true,
        message: "登录成功",
        token,
        expiresAt,
        user: {
          username: userInfo.username,
          nickname: userInfo.nickname,
          avatarUrl: userInfo.avatarUrl,
        },
      }),
      { status: 200, headers: corsHeaders }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, message: "服务器错误: " + err.message }),
      { status: 500, headers: corsHeaders }
    );
  }
}

export function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
