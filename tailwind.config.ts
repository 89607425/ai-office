import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        wx: {
          bg: '#EDEDED',
          panel: '#F7F7F7',
          sidebar: '#E8E8E8',
          header: '#EDEDED',
          green: '#07C160',
          greenDark: '#06AD56',
          bubble: '#FFFFFF',
          bubbleSelf: '#95EC69',
          text: '#191919',
          sub: '#8A8A8A',
          border: '#D9D9D9',
        },
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Microsoft YaHei"',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};

export default config;
