// 注册接口：POST /api/auth/register
// 接收 multipart/form-data：username, password, nickname, avatar(file)
import { getStore } from "@tencent/pages-blob";

export async function onRequestPost({ request }) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json; charset=UTF-8",
  };

  try {
    const formData = await request.formData();
    const username = formData.get("username");
    const password = formData.get("password");
    const nickname = formData.get("nickname");
    const avatarFile = formData.get("avatar");

    // 参数校验
    if (!username || !password || !nickname) {
      return new Response(
        JSON.stringify({ success: false, message: "用户名、密码和昵称不能为空" }),
        { status: 400, headers: corsHeaders }
      );
    }

    if (username.length < 3 || username.length > 20) {
      return new Response(
        JSON.stringify({ success: false, message: "用户名长度需在3-20个字符之间" }),
        { status: 400, headers: corsHeaders }
      );
    }

    if (password.length < 6) {
      return new Response(
        JSON.stringify({ success: false, message: "密码长度不能少于6位" }),
        { status: 400, headers: corsHeaders }
      );
    }

    // 检查用户名是否已存在
    const existingUser = await users_kv.get(`user:${username}`);
    if (existingUser) {
      return new Response(
        JSON.stringify({ success: false, message: "用户名已存在" }),
        { status: 409, headers: corsHeaders }
      );
    }

    // 密码哈希（SHA-256）
    const encoder = new TextEncoder();
    const data = encoder.encode(password + "_pokepai_salt_2026");
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const passwordHash = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");

    // 处理头像上传
    let avatarUrl = "";
    if (avatarFile && avatarFile.size > 0) {
      // 限制头像大小 2MB
      if (avatarFile.size > 2 * 1024 * 1024) {
        return new Response(
          JSON.stringify({ success: false, message: "头像文件不能超过2MB" }),
          { status: 400, headers: corsHeaders }
        );
      }

      const ext = avatarFile.name.split(".").pop() || "png";
      const avatarKey = `avatars/${username}.${ext}`;
      const store = getStore("avatars");
      const arrayBuffer = await avatarFile.arrayBuffer();
      await store.set(avatarKey, arrayBuffer, {
        contentType: avatarFile.type || "image/png",
      });
      avatarUrl = `/api/auth/avatar?user=${username}`;
    }

    // 存储用户信息到 KV
    const userInfo = {
      username,
      nickname,
      passwordHash,
      avatarUrl,
      createdAt: new Date().toISOString(),
    };
    await users_kv.put(`user:${username}`, JSON.stringify(userInfo));

    return new Response(
      JSON.stringify({ success: true, message: "注册成功" }),
      { status: 200, headers: corsHeaders }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, message: "服务器错误: " + err.message }),
      { status: 500, headers: corsHeaders }
    );
  }
}

// 处理 OPTIONS 预检请求
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
