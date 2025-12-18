import axios from 'axios';
import { redisClient } from '../utils/redisClient'; 

// Constants
const BASE_CURRENCY_APP = 'VND'; 
const RATES_CACHE_KEY = 'EXCHANGE_RATES:LATEST'; 
const CACHE_TTL_SECONDS = 3600; 

const OPEN_EXCHANGE_RATES_APP_ID = process.env.OPEN_EXCHANGE_RATES_APP_ID; 
const API_URL = 'https://openexchangerates.org/api'; 

type Rates = { [key: string]: number };

/**
 * Hàm nội bộ: Lấy tỷ giá mới nhất từ API (với cache).
 * Luôn trả về tỷ giá dựa trên USD.
 */
const fetchLatestRates = async (): Promise<Rates> => {
    try {
        const cachedRates = await redisClient.get(RATES_CACHE_KEY);
        if (cachedRates) {
            console.log('✅ Exchange Rates: Cache Hit');
            return JSON.parse(cachedRates) as Rates;
        }
    } catch (cacheError) {
        console.error('Lỗi khi truy xuất Redis Cache:', cacheError);
    }
    
    if (!OPEN_EXCHANGE_RATES_APP_ID) {
        console.error("OPEN_EXCHANGE_RATES_APP_ID is not set. Falling back to dummy rates.");
        return { 'VND': 25000, 'USD': 1, 'EUR': 0.93, 'JPY': 150 };
    }
    
    try {
        console.log('📡 Exchange Rates: Calling OER API');
        const response = await axios.get(
            `${API_URL}/latest.json?app_id=${OPEN_EXCHANGE_RATES_APP_ID}`
        );

        if (response.data.error) {
            throw new Error(`OER API Error: ${response.data.description}`);
        }

        const rates: Rates = response.data.rates;

        try {
            await redisClient.set(
                RATES_CACHE_KEY, 
                JSON.stringify(rates), 
                { EX: CACHE_TTL_SECONDS }
            );
            console.log(`💾 Exchange Rates cached for ${CACHE_TTL_SECONDS} seconds.`);
        } catch (cacheSetError) {
            console.error('Lỗi khi lưu vào Redis Cache:', cacheSetError);
        }

        return rates;

    } catch (error) {
        console.error("❌ Lỗi khi tải tỷ giá hối đoái từ OER:", error);
        throw new Error(`Không thể lấy tỷ giá hối đoái. Vui lòng kiểm tra API Key hoặc dịch vụ.`);
    }
}


/**
 * [DÙNG KHI TẠO GIAO DỊCH]
 * Lấy tỷ giá hối đoái để quy đổi từ một đơn vị tiền tệ bất kỳ (ví dụ: USD)
 * sang đơn vị tiền tệ CƠ SỞ của app (VND).
 * Ví dụ: 1 USD = 25000 VND. Hàm sẽ trả về 25000.
 *
 * @param fromCurrency Mã tiền tệ gốc (ví dụ: "USD")
 * @returns Tỷ giá (ví dụ: 25000)
 */
export const getExchangeRateToVND = async (fromCurrency: string): Promise<number> => {
    const uppercaseFrom = fromCurrency.toUpperCase();
    
    if (uppercaseFrom === BASE_CURRENCY_APP) {
        return 1;
    }

    const rates = await fetchLatestRates();
    
    const rateToVND = rates[BASE_CURRENCY_APP];
    const rateFromCurrency = rates[uppercaseFrom]; 
    
    if (!rateToVND || !rateFromCurrency) {
        throw new Error(`Không tìm thấy tỷ giá hối đoái cho ${fromCurrency} hoặc ${BASE_CURRENCY_APP}.`);
    }

    const calculatedRate = rateToVND / rateFromCurrency;

    return calculatedRate;
};

// Hàm này đã được sửa lại hoàn toàn (thay thế hàm cũ của bạn)
/**
 * [DÙNG CHO DASHBOARD]
 * Lấy tỷ giá quy đổi từ 'baseCurrency' (ví dụ: VND) sang 'targetCurrency' (ví dụ: USD).
 * Hàm này dùng để quy đổi TỔNG (đã ở VND) sang đơn vị tiền tệ người dùng muốn xem.
 *
 * @param baseCurrency Tiền tệ cơ sở (luôn là 'VND' theo logic app)
 * @param targetCurrency Tiền tệ muốn hiển thị (ví dụ: 'USD', 'EUR')
 * @returns Tỷ giá (ví dụ: 1 VND = 0.00004 USD. Hàm trả về 0.00004)
 */
export const getConversionRate = async (baseCurrency: string, targetCurrency: string): Promise<number> => {
    const upperBase = baseCurrency.toUpperCase();
    const upperTarget = targetCurrency.toUpperCase();

    if (upperBase === upperTarget) {
        return 1.0;
    }

    const rates = await fetchLatestRates();

    const baseRate = rates[upperBase];
    const targetRate = rates[upperTarget];

    if (!baseRate) {
        throw new Error(`Không tìm thấy tỷ giá cho tiền tệ cơ sở: ${baseCurrency}`);
    }
    if (!targetRate) {
        throw new Error(`Không tìm thấy tỷ giá cho tiền tệ mục tiêu: ${targetCurrency}`);
    }

    const conversionRate = targetRate / baseRate;

    return conversionRate;
};

export const getExchangeRate = getExchangeRateToVND;

export const SUPPORTED_CURRENCIES = ['VND', 'USD', 'EUR', 'JPY', 'GBP', 'AUD'];