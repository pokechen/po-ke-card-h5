// 用户信息接口：GET /api/auth/me
// 根据 token 返回用户信息

export async function onRequestGet({ request }) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json; charset=UTF-8",
  };

  try {
    // 从 Authorization header 获取 token
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ success: false, message: "未登录" }),
        { status: 401, headers: corsHeaders }
      );
    }

    const token = authHeader.replace("Bearer ", "");

    // 查询 session
    const sessionStr = await users_kv.get(`session:${token}`);
    if (!sessionStr) {
      return new Response(
        JSON.stringify({ success: false, message: "登录已过期，请重新登录" }),
        { status: 401, headers: corsHeaders }
      );
    }

    const session = JSON.parse(sessionStr);

    // 检查 session 是否过期（兜底检查，KV TTL 会自动清理）
    if (session.expiresAt && new Date(session.expiresAt) < new Date()) {
      await users_kv.delete(`session:${token}`);
      return new Response(
        JSON.stringify({ success: false, message: "登录已过期，请重新登录" }),
        { status: 401, headers: corsHeaders }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        user: {
          username: session.username,
          nickname: session.nickname,
          avatarUrl: session.avatarUrl,
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
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
