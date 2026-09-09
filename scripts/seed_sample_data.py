"""Load demo sample parts into data/parts.json."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import storage


SAMPLES = [
    {
        "name": "チップ抵抗 10kΩ",
        "manufacturer": "Yageo",
        "part_number": "RC0603FR-0710KL",
        "category": "抵抗",
        "package": "0603",
        "tolerance": "1%",
        "supplier": "Digi-Key",
        "unit_price": 1.2,
        "stock": 500,
        "notes": "汎用プルアップ用",
    },
    {
        "name": "積層セラミックコンデンサ 0.1uF",
        "manufacturer": "Murata",
        "part_number": "GRM188R71H104KA93D",
        "category": "コンデンサ",
        "package": "0603",
        "voltage_rating": "50V",
        "supplier": "Mouser",
        "unit_price": 3.5,
        "stock": 200,
    },
    {
        "name": "LDO 3.3V",
        "manufacturer": "Texas Instruments",
        "part_number": "AMS1117-3.3",
        "category": "電源IC",
        "package": "SOT-223",
        "voltage_rating": "15V",
        "current_rating": "1A",
        "supplier": "秋月電子",
        "unit_price": 40,
        "stock": 12,
        "datasheet_url": "https://example.com/ams1117.pdf",
    },
    {
        "name": "USB-C レセプタクル",
        "manufacturer": "Hirose",
        "part_number": "CX90B1-24P",
        "category": "コネクタ",
        "package": "SMD",
        "supplier": "Digi-Key",
        "lead_time": "4 weeks",
        "stock": 8,
    },
    {
        "name": "マイコン RP2040",
        "manufacturer": "Raspberry Pi",
        "part_number": "RP2040",
        "category": "MCU",
        "package": "QFN-56",
        "supplier": "Switch Science",
        "unit_price": 120,
        "stock": 5,
        "notes": "Pico 互換設計向け",
    },
]


def main() -> None:
    storage.ensure_data_files()
    existing = storage.load_parts()
    if existing:
        print(f"既に {len(existing)} 件あるためスキップしました。空にしてから再実行してください。")
        return
    for sample in SAMPLES:
        storage.create_part(sample)
    print(f"{len(SAMPLES)} 件のサンプル部品を投入しました。")


if __name__ == "__main__":
    main()
