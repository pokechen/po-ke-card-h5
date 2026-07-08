// 头像获取接口：GET /api/auth/avatar?user=xxx
// 从 Blob 存储读取头像并返回
import { getStore } from "@tencent/pages-blob";

export async function onRequestGet({ request }) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  try {
    const url = new URL(request.url);
    const username = url.searchParams.get("user");

    if (!username) {
      return new Response(
        JSON.stringify({ success: false, message: "缺少用户名参数" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const store = getStore("avatars");

    // 尝试常见图片格式
    const exts = ["png", "jpg", "jpeg", "webp", "gif"];
    let avatarData = null;
    let contentType = "image/png";

    for (const ext of exts) {
      const key = `avatars/${username}.${ext}`;
      const result = await store.get(key);
      if (result) {
        avatarData = result;
        const typeMap = {
          png: "image/png",
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          webp: "image/webp",
          gif: "image/gif",
        };
        contentType = typeMap[ext] || "image/png";
        break;
      }
    }

    if (!avatarData) {
      // 返回默认头像 SVG
      const defaultAvatar = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <rect width="100" height="100" fill="#d6bd92"/>
        <circle cx="50" cy="38" r="18" fill="#775f47"/>
        <ellipse cx="50" cy="82" rx="28" ry="22" fill="#775f47"/>
      </svg>`;
      return new Response(defaultAvatar, {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=3600" },
      });
    }

    return new Response(avatarData, {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": contentType, "Cache-Control": "public, max-age=3600" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, message: "服务器错误: " + err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

export function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
