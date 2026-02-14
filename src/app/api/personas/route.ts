import { NextRequest, NextResponse } from "next/server";
import {
  createCustomPersona,
  getAllCustomPersonas,
  deleteCustomPersona,
} from "@/lib/db";

/** GET /api/personas → 获取所有自定义角色 */
export async function GET() {
  const personas = await getAllCustomPersonas();
  return NextResponse.json({ personas });
}

/** POST /api/personas → 创建自定义角色 */
export async function POST(request: NextRequest) {
  const { name, emoji, description, prompt, temperature } = await request.json();
  if (!name || !prompt) {
    return NextResponse.json({ error: "名称和提示词为必填" }, { status: 400 });
  }
  const persona = await createCustomPersona(
    name,
    emoji || "🤖",
    description || "",
    prompt,
    temperature ?? 0.7
  );
  return NextResponse.json({ persona });
}

/** DELETE /api/personas?id=xxx → 删除自定义角色 */
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "缺少 id" }, { status: 400 });
  }
  await deleteCustomPersona(id);
  return NextResponse.json({ success: true });
}
