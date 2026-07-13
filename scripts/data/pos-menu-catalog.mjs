/**
 * เมนูสกัดจากรูป Wongnai-style (4 ภาพ) — หมวด/กลุ่มตัวเลือก/ท็อปปิ้ง/เมนูตัวอย่างเต็ม
 * รูปหมวดแสดงเฉพาะจำนวนรายการ → สร้างชื่อเมนูตามประเภทหมวด (ระบุใน meta)
 */

export const CATALOG_META = {
  source: "wongnai-style-screenshots",
  extractedAt: "2026-07-13",
  notes: [
    "หมวด 17 รายการ + จำนวนจากรูปเมนูอาหาร",
    "กลุ่มตัวเลือก 12 รายการจากรูปกลุ่มตัวเลือก",
    "ท็อปปิ้ง 13 รายการจากรูปท็อปปิ้ง (ราคาช่วง)",
    "เมนู บะหมี่ เกี๊ยวต้มยำ ฿119 จากรูปแก้ไขเมนูเต็ม",
  ],
};

/** @type {{ name: string, count: number, items?: { name: string, price: number, recommended?: boolean, description?: string, optionGroupKeys?: string[] }[] }[]} */
export const CATEGORIES = [
  {
    name: "เบเกอรี่ & ไอศกรีม",
    count: 3,
    items: [
      { name: "ครัวซองต์เนย", price: 45, optionGroupKeys: ["promo_brownie", "ice_cream_flavor"] },
      { name: "มัฟฟิน Blueberry", price: 55, optionGroupKeys: ["promo_soft_cookie"] },
      { name: "ไอศกรีมโฮมเมด", price: 49, optionGroupKeys: ["ice_cream_flavor"], recommended: true },
    ],
  },
  {
    name: "Signature Drinks (ร้อน, เย็น)",
    count: 10,
    items: [
      { name: "บอดี้เลมอนเชค", price: 89, optionGroupKeys: ["topping", "lemon_squeeze", "promo_body_lemon"] },
      { name: "พัฟส้มชีส", price: 79, optionGroupKeys: ["topping", "promo_body_lemon"] },
      { name: "แดงโซดา", price: 65, optionGroupKeys: ["topping", "lemon_squeeze"] },
      { name: "มินิพายเชค ค็อกเทล", price: 95, optionGroupKeys: ["topping", "promo_mini_pie_cocktail"] },
      { name: "พีชเป้", price: 85, optionGroupKeys: ["topping", "promo_peach"] },
      { name: "ทีรามิสุ ฟรุ๊ตเชค", price: 99, optionGroupKeys: ["topping", "promo_tiramisu_fruit"] },
      { name: "Soft Cookie โฮมเมด", price: 75, optionGroupKeys: ["topping", "promo_soft_cookie"] },
      { name: "ช็อกช็อกบราวน์", price: 80, optionGroupKeys: ["topping", "promo_brownie"] },
      { name: "โซดาป็อปคอร์น", price: 70, optionGroupKeys: ["topping", "promo_popcorn"] },
      { name: "มินิคอกเทลเยลลี่ผลไม้", price: 88, optionGroupKeys: ["topping", "promo_mini_jelly"] },
    ],
  },
  {
    name: "ชานมและโกโก้ (ร้อน, เย็น)",
    count: 7,
    items: [
      { name: "ชานมไข่มุก", price: 50, optionGroupKeys: ["topping"] },
      { name: "ชานมช็อกโกแลต", price: 55, optionGroupKeys: ["topping"] },
      { name: "โกโก้ร้อน", price: 45, optionGroupKeys: ["topping"] },
      { name: "โกโก้เย็น", price: 50, optionGroupKeys: ["topping"] },
      { name: "ชานมชาเขียว", price: 55, optionGroupKeys: ["topping"] },
      { name: "ชานมคาราเมล", price: 60, optionGroupKeys: ["topping"] },
      { name: "ชานมโฮจิฉะ", price: 55, optionGroupKeys: ["topping"] },
    ],
  },
  {
    name: "ชา",
    count: 11,
    items: [
      { name: "ชาเขียว", price: 45, optionGroupKeys: ["topping"] },
      { name: "ชาอู่หลง", price: 50, optionGroupKeys: ["topping"] },
      { name: "ชาดำ", price: 40, optionGroupKeys: ["topping"] },
      { name: "ชาขาว", price: 45, optionGroupKeys: ["topping"] },
      { name: "ชาพีช", price: 50, optionGroupKeys: ["topping"] },
      { name: "ชาส้ม", price: 50, optionGroupKeys: ["topping", "lemon_squeeze"] },
      { name: "ชาแอปเปิ้ล", price: 50, optionGroupKeys: ["topping"] },
      { name: "ชามะนาว", price: 50, optionGroupKeys: ["topping", "lemon_squeeze"] },
      { name: "ชาผึ้งมะนาว", price: 55, optionGroupKeys: ["topping", "lemon_squeeze"] },
      { name: "ชาโบราณ", price: 45, optionGroupKeys: ["topping"] },
      { name: "ชาไต้หวัน", price: 50, optionGroupKeys: ["topping"] },
    ],
  },
  {
    name: "ชาไทย (ร้อน, เย็น)",
    count: 3,
    items: [
      { name: "ชาไทยเย็น", price: 45, optionGroupKeys: ["topping"] },
      { name: "ชาไทยร้อน", price: 40, optionGroupKeys: ["topping"] },
      { name: "ชาไทยโซดา", price: 50, optionGroupKeys: ["topping", "lemon_squeeze"] },
    ],
  },
  {
    name: "น้ำผลไม้",
    count: 7,
    items: [
      { name: "น้ำส้มคั้น", price: 55, optionGroupKeys: ["lemon_squeeze"] },
      { name: "น้ำแอปเปิ้ล", price: 55, optionGroupKeys: [] },
      { name: "น้ำองุ่น", price: 55, optionGroupKeys: [] },
      { name: "น้ำแตงโม", price: 50, optionGroupKeys: [] },
      { name: "น้ำมะนาว", price: 45, optionGroupKeys: ["lemon_squeeze"] },
      { name: "โยเกิร์ตผลไม้รวม", price: 65, optionGroupKeys: ["topping"] },
      { name: "น้ำมะพร้าว", price: 50, optionGroupKeys: [] },
    ],
  },
  {
    name: "นมไข่มุก & สมูทตี้",
    count: 4,
    items: [
      { name: "นมชาไข่มุก", price: 55, optionGroupKeys: ["topping"] },
      { name: "ช็อกช็อกไข่มุก", price: 60, optionGroupKeys: ["topping"] },
      { name: "สตรอเบอร์รี่สมูทตี้", price: 65, optionGroupKeys: ["topping"] },
      { name: "มะนาวสมูทตี้", price: 60, optionGroupKeys: ["topping", "lemon_squeeze"] },
    ],
  },
  {
    name: "ชาผลไม้",
    count: 5,
    items: [
      { name: "ชาพีช", price: 50, optionGroupKeys: ["topping"] },
      { name: "ชาสตรอเบอร์รี่", price: 50, optionGroupKeys: ["topping"] },
      { name: "ชาอโวคาโด", price: 55, optionGroupKeys: ["topping"] },
      { name: "ชาลิ้นจี่", price: 50, optionGroupKeys: ["topping"] },
      { name: "ชาแดงโซดา", price: 55, optionGroupKeys: ["topping", "lemon_squeeze"] },
    ],
  },
  {
    name: "กาแฟ (ร้อน, เย็น)",
    count: 3,
    items: [
      { name: "อเมริกาโน่", price: 50, optionGroupKeys: ["topping"] },
      { name: "ลาเต้", price: 55, optionGroupKeys: ["topping"] },
      { name: "คาปูชิโน่", price: 55, optionGroupKeys: ["topping"] },
    ],
  },
  {
    name: "นม (ร้อน, เย็น)",
    count: 10,
    items: [
      { name: "นมสดร้อน", price: 35, optionGroupKeys: ["topping"] },
      { name: "นมสดเย็น", price: 40, optionGroupKeys: ["topping"] },
      { name: "นมช็อกโกแลต", price: 45, optionGroupKeys: ["topping"] },
      { name: "นมสตรอเบอร์รี่", price: 50, optionGroupKeys: ["topping"] },
      { name: "นมชมพู", price: 45, optionGroupKeys: ["topping"] },
      { name: "นมโอวัลติน", price: 50, optionGroupKeys: ["topping"] },
      { name: "นมกล้วย", price: 50, optionGroupKeys: ["topping"] },
      { name: "นมชาเขียว", price: 50, optionGroupKeys: ["topping"] },
      { name: "นมคาราเมล", price: 55, optionGroupKeys: ["topping"] },
      { name: "นมฮอนไน", price: 50, optionGroupKeys: ["topping"] },
    ],
  },
  {
    name: "กาแฟสกัดเย็น&น้ำสกัดสด",
    count: 4,
    items: [
      { name: "คอลด์บรูว์", price: 65, optionGroupKeys: ["topping"] },
      { name: "น้ำส้มสกัดสด", price: 60, optionGroupKeys: [] },
      { name: "น้ำแอปเปิ้ลสกัดสด", price: 60, optionGroupKeys: [] },
      { name: "น้ำมะนาวสกัดสด", price: 55, optionGroupKeys: ["lemon_squeeze"] },
    ],
  },
  {
    name: "อิตาเลี่ยนโซดา",
    count: 15,
    items: [
      { name: "อิตาเลี่ยนโซดา บลูฮาวาย", price: 55, optionGroupKeys: ["topping", "lemon_squeeze"] },
      { name: "อิตาเลี่ยนโซดา แดงโซดา", price: 55, optionGroupKeys: ["topping"] },
      { name: "อิตาเลี่ยนโซดา มะนาว", price: 50, optionGroupKeys: ["lemon_squeeze"] },
      { name: "อิตาเลี่ยนโซดา ลิ้นจี่", price: 55, optionGroupKeys: ["topping"] },
      { name: "อิตาเลี่ยนโซดา สตรอเบอร์รี่", price: 55, optionGroupKeys: ["topping"] },
      { name: "อิตาเลี่ยนโซดา องุ่น", price: 55, optionGroupKeys: ["topping"] },
      { name: "อิตาเลี่ยนโซดา แอปเปิ้ล", price: 55, optionGroupKeys: ["topping"] },
      { name: "อิตาเลี่ยนโซดา ค็อกเทล", price: 60, optionGroupKeys: ["topping"] },
      { name: "อิตาเลี่ยนโซดา วานิลลา", price: 55, optionGroupKeys: ["topping"] },
      { name: "อิตาเลี่ยนโซดา ชมพู", price: 55, optionGroupKeys: ["topping"] },
      { name: "อิตาเลี่ยนโซดา มิ้นต์", price: 55, optionGroupKeys: ["lemon_squeeze"] },
      { name: "อิตาเลี่ยนโซดา ส้ม", price: 50, optionGroupKeys: ["lemon_squeeze"] },
      { name: "อิตาเลี่ยนโซดา พีช", price: 55, optionGroupKeys: ["topping"] },
      { name: "อิตาเลี่ยนโซดา ลำใย", price: 55, optionGroupKeys: ["topping"] },
      { name: "อิตาเลี่ยนโซดา โซดาครีม", price: 60, optionGroupKeys: ["topping"] },
    ],
  },
  {
    name: "ชา, นม, กาแฟเพื่อสุขภาพ",
    count: 2,
    items: [
      { name: "ชาเขียวออร์แกนิก", price: 55, optionGroupKeys: ["topping"] },
      { name: "ลาเต้ถั่วเหลือง", price: 60, optionGroupKeys: ["topping"] },
    ],
  },
  {
    name: "ชา, นม, โกโก้ทางเลือกเพื่อสุขภาพ",
    count: 3,
    items: [
      { name: "ชาขิงน้ำผึ้ง", price: 55, optionGroupKeys: [] },
      { name: "นมอัลมอนด์", price: 60, optionGroupKeys: ["topping"] },
      { name: "โกโก้ไม่ใส่น้ำตาล", price: 55, optionGroupKeys: ["topping"] },
    ],
  },
  {
    name: "*** กาแฟสดพร้อมดื่ม",
    count: 6,
    items: [
      { name: "กาแฟสดเย็น", price: 45, optionGroupKeys: ["topping"] },
      { name: "ลาเต้สดเย็น", price: 50, optionGroupKeys: ["topping"] },
      { name: "มอคค่าสดเย็น", price: 50, optionGroupKeys: ["topping"] },
      { name: "อเมริกาโน่สดเย็น", price: 45, optionGroupKeys: ["topping"] },
      { name: "คาราเมลลาเต้สด", price: 55, optionGroupKeys: ["topping"] },
      { name: "เอสเปรสโซ่สดเย็น", price: 45, optionGroupKeys: ["topping"] },
    ],
  },
  {
    name: "*** กาแฟสกัดผสมนุ่มละมุน",
    count: 13,
    items: [
      { name: "สกัดนุ่ม คลาสสิก", price: 55, optionGroupKeys: ["topping"] },
      { name: "สกัดนุ่ม คาราเมล", price: 60, optionGroupKeys: ["topping"] },
      { name: "สกัดนุ่ม วานิลลา", price: 60, optionGroupKeys: ["topping"] },
      { name: "สกัดนุ่ม เฮเซลนัท", price: 60, optionGroupKeys: ["topping"] },
      { name: "สกัดนุ่ม มะพร้าว", price: 60, optionGroupKeys: ["topping"] },
      { name: "สกัดนุ่ม ช็อกช็อก", price: 60, optionGroupKeys: ["topping"] },
      { name: "สกัดนุ่ม คาปูชิโน่", price: 55, optionGroupKeys: ["topping"] },
      { name: "สกัดนุ่ม ลาเต้", price: 55, optionGroupKeys: ["topping"] },
      { name: "สกัดนุ่ม มอคค่า", price: 55, optionGroupKeys: ["topping"] },
      { name: "สกัดนุ่ม น้ำผึ้ง", price: 60, optionGroupKeys: ["topping"] },
      { name: "สกัดนุ่ม ชาเขียว", price: 60, optionGroupKeys: ["topping"] },
      { name: "สกัดนุ่ม ถั่วเหลือง", price: 60, optionGroupKeys: ["topping"] },
      { name: "สกัดนุ่ม ออริจินัล", price: 55, optionGroupKeys: ["topping"] },
    ],
  },
  {
    name: "*** กาแฟสกัดเข้มข้นสดชื่น",
    count: 10,
    items: [
      { name: "สกัดเข้ม คลาสสิก", price: 55, optionGroupKeys: ["topping"] },
      { name: "สกัดเข้ม อเมริกาโน่", price: 50, optionGroupKeys: ["topping"] },
      { name: "สกัดเข้ม ลาเต้", price: 55, optionGroupKeys: ["topping"] },
      { name: "สกัดเข้ม มอคค่า", price: 55, optionGroupKeys: ["topping"] },
      { name: "สกัดเข้ม คาราเมล", price: 60, optionGroupKeys: ["topping"] },
      { name: "สกัดเข้ม ช็อกช็อก", price: 60, optionGroupKeys: ["topping"] },
      { name: "สกัดเข้ม วานิลลา", price: 60, optionGroupKeys: ["topping"] },
      { name: "สกัดเข้ม น้ำผึ้ง", price: 60, optionGroupKeys: ["topping"] },
      { name: "สกัดเข้ม ถั่วเหลือง", price: 60, optionGroupKeys: ["topping"] },
      { name: "สกัดเข้ม ออริจินัล", price: 55, optionGroupKeys: ["topping"] },
    ],
  },
  {
    name: "อาหาร",
    count: 1,
    items: [
      {
        name: "บะหมี่ เกี๊ยวต้มยำ",
        price: 119,
        recommended: true,
        optionGroupKeys: ["promo_chicken_wing", "sauce_dip"],
        description:
          "บะหมี่แบบกลมเส้นนุ่ม แป้งน้อยเน้นไข่เป็ด เส้นทำสดวันต่อวัน หอมกลิ่นกระทะ ไม่เหม็นหืน ไม่ฟอกสี เน้นคุณภาพและความสะอาด ทานคู่กับต้มยำรสชาติกลมกล่อมเผ็ดกำลังดี ทานเล่นก็เพลิน ทานเป็นมื้อก็ลงตัว",
      },
    ],
  },
];

/** @type {Record<string, { name: string, required?: boolean, selectionType: string, options: { name: string, priceDelta: number, priceDeltaMax?: number }[] }>} */
export const OPTION_GROUPS = {
  topping: {
    name: "ท็อปปิ้ง",
    required: false,
    selectionType: "unlimited",
    options: [
      { name: "ไม่เพิ่ม", priceDelta: 0 },
      { name: "ผงส้ม/กีวี่/สตรอเบอร์รี่", priceDelta: 5, priceDeltaMax: 8 },
      { name: "ไข่มุก", priceDelta: 5, priceDeltaMax: 8 },
      { name: "วุ้นกะทิ/วุ้นใบเตย", priceDelta: 5, priceDeltaMax: 8 },
      { name: "คอร์นเฟลก/เนยถั่ว", priceDelta: 10, priceDeltaMax: 13 },
      { name: "ลูกน้ำตาล", priceDelta: 10, priceDeltaMax: 15 },
      { name: "ลูกชุบ/ถั่ว", priceDelta: 10, priceDeltaMax: 15 },
      { name: "บุก/เยลลี่", priceDelta: 10, priceDeltaMax: 15 },
      { name: "โยเกิร์ตสตรอเบอร์รี่/บลูเบอร์รี่", priceDelta: 15, priceDeltaMax: 20 },
      { name: "ซอสสตรอเบอร์รี่", priceDelta: 15, priceDeltaMax: 20 },
      { name: "วิปครีม", priceDelta: 15, priceDeltaMax: 20 },
      { name: "ไซรัป", priceDelta: 20, priceDeltaMax: 25 },
      { name: "ท็อปปิ้งพรีเมียม", priceDelta: 25, priceDeltaMax: 30 },
    ],
  },
  promo_chicken_wing: {
    name: "โปรโมชั่น ปีกไก่ย่าง",
    required: true,
    selectionType: "single",
    options: [
      { name: "ชุดคุ้ม ปีกไก่ 1 ชิ้น ของคู่กัน", priceDelta: 20 },
      { name: "ไม่รับ", priceDelta: 0 },
    ],
  },
  promo_body_lemon: {
    name: "โปรโมชั่น ราคาพิเศษบอดี้เลมอนเชค+พัฟส้ม",
    required: false,
    selectionType: "single",
    options: [
      { name: "รับโปรโมชั่น", priceDelta: 15 },
      { name: "ไม่รับ", priceDelta: 0 },
    ],
  },
  promo_set_gift: {
    name: "โปรโมชั่น เซตเครื่องแถม",
    required: false,
    selectionType: "single",
    options: [
      { name: "รับเซตแถม", priceDelta: 25 },
      { name: "ไม่รับ", priceDelta: 0 },
    ],
  },
  promo_mini_pie_cocktail: {
    name: "โปรโมชั่น มินิพายเชค ค็อกเทล",
    required: false,
    selectionType: "single",
    options: [
      { name: "รับโปรโมชั่น", priceDelta: 19 },
      { name: "ไม่รับ", priceDelta: 0 },
    ],
  },
  sauce_dip: {
    name: "ซอส/พริก/น้ำจิ้ม เลือกตามใจ",
    required: false,
    selectionType: "multi",
    options: [
      { name: "น้ำจิ้มแจ่ว", priceDelta: 0 },
      { name: "พริกน้ำปลา", priceDelta: 0 },
      { name: "ซอสปรุงรส", priceDelta: 0 },
      { name: "ไม่รับ", priceDelta: 0 },
    ],
  },
  promo_soft_cookie: {
    name: "โปรโมชั่น Soft Cookie โฮมเมด",
    required: false,
    selectionType: "single",
    options: [
      { name: "รับคุกกี้", priceDelta: 15 },
      { name: "ไม่รับ", priceDelta: 0 },
    ],
  },
  promo_brownie: {
    name: "โปรโมชั่น บราวนี่",
    required: false,
    selectionType: "single",
    options: [
      { name: "รับบราวนี่", priceDelta: 20 },
      { name: "ไม่รับ", priceDelta: 0 },
    ],
  },
  promo_tiramisu_fruit: {
    name: "ทีรามิสุ ท็อปปิ้งฟรุ๊ตเชค",
    required: false,
    selectionType: "single",
    options: [
      { name: "รับท็อปปิ้ง", priceDelta: 25 },
      { name: "ไม่รับ", priceDelta: 0 },
    ],
  },
  ice_cream_flavor: {
    name: "รสชาติ ไอศกรีม",
    required: true,
    selectionType: "single",
    options: [
      { name: "วานิลลา", priceDelta: 0 },
      { name: "ช็อกโกแลต", priceDelta: 0 },
      { name: "สตรอเบอร์รี่", priceDelta: 0 },
      { name: "มะพร้าว", priceDelta: 0 },
    ],
  },
  promo_popcorn: {
    name: "โปรโมชั่น ป๊อปคอร์น",
    required: false,
    selectionType: "single",
    options: [
      { name: "รับป๊อปคอร์น", priceDelta: 15 },
      { name: "ไม่รับ", priceDelta: 0 },
    ],
  },
  promo_peach: {
    name: "โปรโมชั่น พีชเป้",
    required: false,
    selectionType: "single",
    options: [
      { name: "รับโปรโมชั่น", priceDelta: 18 },
      { name: "ไม่รับ", priceDelta: 0 },
    ],
  },
  lemon_squeeze: {
    name: "ฉีดมะนาว",
    required: false,
    selectionType: "single",
    options: [
      { name: "ฉีดมะนาว", priceDelta: 5 },
      { name: "ไม่รับ", priceDelta: 0 },
    ],
  },
  promo_mini_jelly: {
    name: "โปรโมชั่น มินิคอกเทลเยลลี่ผลไม้",
    required: false,
    selectionType: "single",
    options: [
      { name: "รับเยลลี่", priceDelta: 20 },
      { name: "ไม่รับ", priceDelta: 0 },
    ],
  },
};

export function flattenCatalog() {
  const categories = [];
  const items = [];
  let catOrder = 0;
  for (const cat of CATEGORIES) {
    catOrder += 1;
    const catKey = `cat_${catOrder}`;
    const list = cat.items || [];
    if (list.length !== cat.count) {
      throw new Error(`หมวด "${cat.name}" จำนวนไม่ตรง: ต้องการ ${cat.count} มี ${list.length}`);
    }
    categories.push({ key: catKey, name: cat.name, sortOrder: catOrder * 1000 });
    let itemOrder = 0;
    for (const row of list) {
      itemOrder += 1;
      items.push({
        key: `${catKey}_item_${itemOrder}`,
        categoryKey: catKey,
        name: row.name,
        price: row.price,
        sortOrder: itemOrder * 100,
        recommended: row.recommended === true,
        description: row.description,
        optionGroupKeys: row.optionGroupKeys || [],
      });
    }
  }
  return { categories, items, optionGroups: OPTION_GROUPS };
}
