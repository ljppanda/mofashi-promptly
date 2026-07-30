/** @type {import('tailwindcss').Config} */
export default {
  // 扫描真实源文件生成工具类，替代原 cdn.tailwindcss.com 运行时依赖（构建期编译，零第三方运行时）。
  content: ["./index.html", "./src/**/*.{ts,js,tsx,jsx,html}"],
  theme: {
    extend: {},
  },
  plugins: [],
};
