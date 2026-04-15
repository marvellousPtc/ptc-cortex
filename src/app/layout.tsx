import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession } from "@/lib/auth-check";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PTC Cortex - AI 智能中枢",
  description: "PTC 的 AI 能力中心，为所有项目提供智能服务",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // 本地开发跳过认证，生产环境查数据库验证 session
  const isDev = process.env.NODE_ENV === "development";

  if (!isDev) {
    const cookieStore = await cookies();
    const sessionToken =
      cookieStore.get("__Secure-authjs.session-token")?.value ||
      cookieStore.get("authjs.session-token")?.value;

    if (!sessionToken || !(await verifySession(sessionToken))) {
      const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";
      redirect(`/login?callbackUrl=${encodeURIComponent(basePath)}`);
    }
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{
var hex=localStorage.getItem("accentHex");
if(!hex||!/^#[0-9a-fA-F]{6}$/.test(hex))return;
function p(h){h=h.replace("#","");return[parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)]}
function hsl(r,g,b){r/=255;g/=255;b/=255;var mx=Math.max(r,g,b),mn=Math.min(r,g,b),l=(mx+mn)/2;if(mx===mn)return[0,0,l];var d=mx-mn,s=l>.5?d/(2-mx-mn):d/(mx+mn),h=0;if(mx===r)h=((g-b)/d+(g<b?6:0))/6;else if(mx===g)h=((b-r)/d+2)/6;else h=((r-g)/d+4)/6;return[h,s,l]}
function hx(h,s,l){function q(p,q,t){if(t<0)t+=1;if(t>1)t-=1;if(t<1/6)return p+(q-p)*6*t;if(t<.5)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p}var r,g,b;if(s===0){r=g=b=l}else{var Q=l<.5?l*(1+s):l+s-l*s,P=2*l-Q;r=q(P,Q,h+1/3);g=q(P,Q,h);b=q(P,Q,h-1/3)}function t(v){return Math.round(v*255).toString(16).padStart(2,"0")}return"#"+t(r)+t(g)+t(b)}
function li(c,a){var rgb=p(c),h=hsl(rgb[0],rgb[1],rgb[2]);return hx(h[0],h[1],Math.min(1,h[2]+a))}
function da(c,a){var rgb=p(c),h=hsl(rgb[0],rgb[1],rgb[2]);return hx(h[0],h[1],Math.max(0,h[2]-a))}
var dm=document.documentElement.getAttribute("data-theme")==="dark"||(document.documentElement.getAttribute("data-theme")!=="light"&&window.matchMedia("(prefers-color-scheme:dark)").matches);
var r=p(hex),R=r[0],G=r[1],B=r[2],v={};
if(dm){var lh=li(hex,.2),lr=p(lh),bh=li(hex,.35),sh=li(hex,.1);v={"--c-accent":lh,"--c-accent-soft":"rgba("+lr[0]+","+lr[1]+","+lr[2]+",0.08)","--c-accent-border":"rgba("+lr[0]+","+lr[1]+","+lr[2]+",0.18)","--c-accent-text":bh,"--c-green-soft":"rgba("+lr[0]+","+lr[1]+","+lr[2]+",0.08)","--c-green-text":lh,"--c-user-bubble":"linear-gradient(135deg,"+hex+","+lh+")","--c-ai-avatar-from":"rgba("+lr[0]+","+lr[1]+","+lr[2]+",0.14)","--c-ai-avatar-to":"rgba("+lr[0]+","+lr[1]+","+lr[2]+",0.05)","--c-inline-code-bg":"rgba("+lr[0]+","+lr[1]+","+lr[2]+",0.1)","--c-inline-code-text":bh,"--c-blockquote-border":"rgba("+lr[0]+","+lr[1]+","+lr[2]+",0.25)","--c-link":bh,"--c-btn-gradient":"linear-gradient(135deg,"+da(hex,.05)+","+sh+")","--c-btn-shadow":"rgba("+lr[0]+","+lr[1]+","+lr[2]+",0.25)","--c-logo-gradient":"linear-gradient(135deg,"+lh+","+bh+")"}}
else{var dh=da(hex,.08),sh2=li(hex,.15);v={"--c-accent":hex,"--c-accent-soft":"rgba("+R+","+G+","+B+",0.06)","--c-accent-border":"rgba("+R+","+G+","+B+",0.15)","--c-accent-text":dh,"--c-green-soft":"rgba("+R+","+G+","+B+",0.06)","--c-green-text":hex,"--c-user-bubble":"linear-gradient(135deg,"+dh+","+sh2+")","--c-ai-avatar-from":"rgba("+R+","+G+","+B+",0.12)","--c-ai-avatar-to":"rgba("+R+","+G+","+B+",0.04)","--c-inline-code-bg":"rgba("+R+","+G+","+B+",0.06)","--c-inline-code-text":dh,"--c-blockquote-border":"rgba("+R+","+G+","+B+",0.25)","--c-link":dh,"--c-btn-gradient":"linear-gradient(135deg,"+dh+","+sh2+")","--c-btn-shadow":"rgba("+R+","+G+","+B+",0.25)","--c-logo-gradient":"linear-gradient(135deg,"+hex+","+sh2+")"}}
var s=document.documentElement.style;for(var k in v)s.setProperty(k,v[k]);
}catch(e){}})()` }} />
        <ThemeProvider attribute="data-theme" defaultTheme="system" enableSystem>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
