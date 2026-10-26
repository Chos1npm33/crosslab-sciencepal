import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CrossLab · 跨界研究器",
  description: "从研究问题、跨界方法到有依据的研究方案。SciencePal AI4Science 研究工作台。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
