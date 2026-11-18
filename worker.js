export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    const headers = { ...cors, "Content-Type": "application/json" };
    const json = (data, status=200) => new Response(JSON.stringify(data), { status, headers });
    const url = new URL(request.url);
    if (request.method !== "POST") return json({ error: "Gunakan POST." }, 405);
    const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "API Key NVIDIA belum dimasukkan di website." }, 401);
    let body;
    try { body = await request.json(); } catch { return json({ error: "Isi permintaan tidak valid." }, 400); }

    if (url.pathname === "/api/story") {
      if (!body.idea || !body.model) return json({ error: "Ide dan model wajib diisi." }, 400);
      const prompt = `Buat paket pra-produksi video singkat dalam Bahasa Indonesia. Gaya visual: ${body.style || "Animasi 3D"}. Ide: ${body.idea}
Buat: judul, logline, daftar karakter dengan ciri visual yang konsisten, naskah ringkas, lalu satu prompt video bahasa Inggris yang siap diuji. Jangan mengklaim video sudah dibuat. Keluarkan teks biasa dengan bagian VIDEO_PROMPT: pada akhir.`;
      const upstream = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: body.model, messages: [{ role: "user", content: prompt }], max_tokens: 1800, temperature: 0.7 })
      });
      const data = await upstream.json().catch(() => ({}));
      if (!upstream.ok) return json({ error: data?.error?.message || data?.detail || `NVIDIA chat API error ${upstream.status}` }, upstream.status);
      const text = data?.choices?.[0]?.message?.content || "";
      const match = text.match(/VIDEO_PROMPT:\s*([\s\S]*)$/i);
      return json({ text, video_prompt: match ? match[1].trim() : text });
    }

    if (url.pathname === "/api/video") {
      if (!body.prompt) return json({ error: "Prompt video wajib diisi." }, 400);
      const upstream = await fetch("https://ai.api.nvidia.com/v1/cosmos/nvidia/cosmos3-nano", {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({
          model_mode: "text2video",
          prompt: body.prompt,
          resolution: body.resolution || "480_16_9",
          num_frames: Math.min(Math.max(Number(body.num_frames) || 25, 1), 73),
          num_inference_steps: 35,
          fps: 24
        })
      });
      const data = await upstream.json().catch(() => ({}));
      if (!upstream.ok) return json({ error: data?.detail || data?.error?.message || `Cosmos API error ${upstream.status}` }, upstream.status);
      if (!data.b64_video) return json({ error: "NVIDIA tidak mengembalikan b64_video. Periksa model dan respons endpoint." }, 502);
      const bytes = Uint8Array.from(atob(data.b64_video), c => c.charCodeAt(0));
      const key = `video-${crypto.randomUUID()}.mp4`;
      // Video disimpan sementara di browser lewat respons data URL agar prototipe tidak memerlukan storage tambahan.
      let binary = "";
      for (let i=0; i<bytes.length; i+=0x8000) binary += String.fromCharCode(...bytes.subarray(i, i+0x8000));
      return json({ video_url: `data:video/mp4;base64,${btoa(binary)}`, filename: key });
    }
    return json({ error: "Rute tidak ditemukan." }, 404);
  }
};
