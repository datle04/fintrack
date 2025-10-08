import fetch from 'node-fetch';

async function translateToEnglish(text: string) {
  const res = await fetch(
    `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(text)}`
  );
  const data: any = await res.json();
  return data[0][0][0]; // bản dịch tiếng Anh
}