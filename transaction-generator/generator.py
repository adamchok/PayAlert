#!/usr/bin/env python3
"""
PayAlert Transaction Generator v2.0
Streams enriched, realistic financial transaction events into the PayAlert
SQS pipeline. Supports continuous streaming, fixed-batch, and dry-run modes,
with configurable fraud-scenario injection.

Environment Variables:
    AWS_REGION       – Target AWS region          (default: ap-southeast-1)
    SQS_QUEUE_URL    – SQS queue endpoint URL      (required unless --dry-run)
    MIN_INTERVAL     – Min seconds between bursts  (default: 0.1)
    MAX_INTERVAL     – Max seconds between bursts  (default: 2.0)
    BURST_SIZE_MIN   – Min transactions per burst  (default: 1)
    BURST_SIZE_MAX   – Max transactions per burst  (default: 5)
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import random
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import boto3
from botocore.exceptions import ClientError, NoCredentialsError

# ── Constants ────────────────────────────────────────────────────────────────

GENERATOR_VERSION = "2.0.0"
MYT = timezone(timedelta(hours=8))  # Malaysia Time (UTC+8)

# ── Defaults (overridden by env / CLI) ───────────────────────────────────────

AWS_REGION    = os.getenv("AWS_REGION",       "ap-southeast-1")
SQS_QUEUE_URL = os.getenv("SQS_QUEUE_URL",    "")
MIN_INTERVAL  = float(os.getenv("MIN_INTERVAL",    "0.1"))
MAX_INTERVAL  = float(os.getenv("MAX_INTERVAL",    "2.0"))
BURST_MIN     = int(os.getenv("BURST_SIZE_MIN",    "1"))
BURST_MAX     = int(os.getenv("BURST_SIZE_MAX",    "5"))

# ── FX Rates (to MYR) ────────────────────────────────────────────────────────

FX_RATES: dict[str, float] = {
    "MYR": 1.00,
    "USD": 4.72,
    "SGD": 3.50,
    "GBP": 5.95,
    "AUD": 3.01,
    "EUR": 5.11,
    "JPY": 0.031,
    "CNY": 0.65,
    "IDR": 0.00029,
    "THB": 0.13,
}

# ── Customer Accounts ─────────────────────────────────────────────────────────

ACCOUNTS: list[dict] = [
    {
        "accountId":    "ACC-MY-4F291A3B",
        "customerId":   "CUST-4F291A3B",
        "customerName": "Ahmad Farid bin Ismail",
        "customerTier": "GOLD",
        "cardLast4":    "4821",
        "cardType":     "VISA_DEBIT",
        "homeCity":     "Kuala Lumpur",
        "homeState":    "Wilayah Persekutuan",
        "homeCountry":  "MY",
        "tierSpendCap": 5_000.0,
    },
    {
        "accountId":    "ACC-MY-7C8D1E4F",
        "customerId":   "CUST-7C8D1E4F",
        "customerName": "Nurul Ain binti Razak",
        "customerTier": "PLATINUM",
        "cardLast4":    "7753",
        "cardType":     "MASTERCARD_CREDIT",
        "homeCity":     "Petaling Jaya",
        "homeState":    "Selangor",
        "homeCountry":  "MY",
        "tierSpendCap": 15_000.0,
    },
    {
        "accountId":    "ACC-MY-2B5E9C1D",
        "customerId":   "CUST-2B5E9C1D",
        "customerName": "Lim Wei Jian",
        "customerTier": "SILVER",
        "cardLast4":    "3390",
        "cardType":     "MASTERCARD_DEBIT",
        "homeCity":     "Johor Bahru",
        "homeState":    "Johor",
        "homeCountry":  "MY",
        "tierSpendCap": 2_000.0,
    },
    {
        "accountId":    "ACC-MY-9A6F2D8E",
        "customerId":   "CUST-9A6F2D8E",
        "customerName": "Priya a/p Subramaniam",
        "customerTier": "GOLD",
        "cardLast4":    "5512",
        "cardType":     "VISA_CREDIT",
        "homeCity":     "George Town",
        "homeState":    "Penang",
        "homeCountry":  "MY",
        "tierSpendCap": 5_000.0,
    },
    {
        "accountId":    "ACC-MY-3D7B0F5A",
        "customerId":   "CUST-3D7B0F5A",
        "customerName": "Muhammad Zulkifli bin Hassan",
        "customerTier": "STANDARD",
        "cardLast4":    "9204",
        "cardType":     "VISA_DEBIT",
        "homeCity":     "Ipoh",
        "homeState":    "Perak",
        "homeCountry":  "MY",
        "tierSpendCap": 1_000.0,
    },
    {
        "accountId":    "ACC-MY-1E4C8B7F",
        "customerId":   "CUST-1E4C8B7F",
        "customerName": "Siti Norzahra binti Kamarudin",
        "customerTier": "PLATINUM",
        "cardLast4":    "6641",
        "cardType":     "MASTERCARD_CREDIT",
        "homeCity":     "Kuala Lumpur",
        "homeState":    "Wilayah Persekutuan",
        "homeCountry":  "MY",
        "tierSpendCap": 15_000.0,
    },
    {
        "accountId":    "ACC-MY-6A0D3E2C",
        "customerId":   "CUST-6A0D3E2C",
        "customerName": "Rajesh a/l Krishnamurthy",
        "customerTier": "SILVER",
        "cardLast4":    "8813",
        "cardType":     "VISA_DEBIT",
        "homeCity":     "Shah Alam",
        "homeState":    "Selangor",
        "homeCountry":  "MY",
        "tierSpendCap": 2_000.0,
    },
    {
        "accountId":    "ACC-MY-5F1B9A4D",
        "customerId":   "CUST-5F1B9A4D",
        "customerName": "Tan Mei Ling",
        "customerTier": "GOLD",
        "cardLast4":    "2277",
        "cardType":     "MASTERCARD_CREDIT",
        "homeCity":     "Subang Jaya",
        "homeState":    "Selangor",
        "homeCountry":  "MY",
        "tierSpendCap": 5_000.0,
    },
    {
        "accountId":    "ACC-MY-8C2E6D0B",
        "customerId":   "CUST-8C2E6D0B",
        "customerName": "Faizal bin Abdul Rahman",
        "customerTier": "STANDARD",
        "cardLast4":    "4409",
        "cardType":     "VISA_DEBIT",
        "homeCity":     "Kota Kinabalu",
        "homeState":    "Sabah",
        "homeCountry":  "MY",
        "tierSpendCap": 1_000.0,
    },
    {
        "accountId":    "ACC-MY-0B8F5C3A",
        "customerId":   "CUST-0B8F5C3A",
        "customerName": "Wong Kok Wai",
        "customerTier": "GOLD",
        "cardLast4":    "1156",
        "cardType":     "VISA_CREDIT",
        "homeCity":     "Kuching",
        "homeState":    "Sarawak",
        "homeCountry":  "MY",
        "tierSpendCap": 5_000.0,
    },
]

# ── Merchant Catalogue ────────────────────────────────────────────────────────

# Tuple: (min_amount, max_amount) in the merchant's native currency.
MERCHANTS_GENERAL: list[dict] = [
    # Grocery & Supermarket
    {"merchantId": "MER-LSS-0001",  "merchantName": "Lotus's Supermarket",   "merchantCategory": "GROCERY",            "merchantCity": "Kuala Lumpur", "merchantState": "Wilayah Persekutuan", "merchantCountry": "MY", "currency": "MYR", "amountRange": (18.0,  380.0), "channels": ["POS", "CONTACTLESS", "ONLINE"]},
    {"merchantId": "MER-AEON-0001", "merchantName": "AEON Mall",             "merchantCategory": "DEPARTMENT_STORE",   "merchantCity": "Subang Jaya",  "merchantState": "Selangor",            "merchantCountry": "MY", "currency": "MYR", "amountRange": (45.0,  900.0), "channels": ["POS", "CONTACTLESS"]},
    {"merchantId": "MER-MYD-0001",  "merchantName": "Mydin Hypermarket",     "merchantCategory": "GROCERY",            "merchantCity": "Shah Alam",    "merchantState": "Selangor",            "merchantCountry": "MY", "currency": "MYR", "amountRange": (12.0,  280.0), "channels": ["POS", "CONTACTLESS"]},
    {"merchantId": "MER-COLD-0001", "merchantName": "Cold Storage",          "merchantCategory": "GROCERY",            "merchantCity": "Kuala Lumpur", "merchantState": "Wilayah Persekutuan", "merchantCountry": "MY", "currency": "MYR", "amountRange": (25.0,  450.0), "channels": ["POS", "CONTACTLESS"]},
    {"merchantId": "MER-JAYA-0001", "merchantName": "Jaya Grocer",           "merchantCategory": "GROCERY",            "merchantCity": "Petaling Jaya","merchantState": "Selangor",            "merchantCountry": "MY", "currency": "MYR", "amountRange": (30.0,  500.0), "channels": ["POS", "CONTACTLESS", "ONLINE"]},
    # Food & Beverage
    {"merchantId": "MER-MCD-0001",  "merchantName": "McDonald's Malaysia",   "merchantCategory": "FAST_FOOD",          "merchantCity": "Kuala Lumpur", "merchantState": "Wilayah Persekutuan", "merchantCountry": "MY", "currency": "MYR", "amountRange": (7.0,   65.0),  "channels": ["POS", "CONTACTLESS", "MOBILE_APP"]},
    {"merchantId": "MER-KFC-0001",  "merchantName": "KFC Malaysia",          "merchantCategory": "FAST_FOOD",          "merchantCity": "Petaling Jaya","merchantState": "Selangor",            "merchantCountry": "MY", "currency": "MYR", "amountRange": (9.0,   80.0),  "channels": ["POS", "CONTACTLESS", "ONLINE"]},
    {"merchantId": "MER-GRAB-0001", "merchantName": "GrabFood",              "merchantCategory": "FOOD_DELIVERY",      "merchantCity": "Kuala Lumpur", "merchantState": "Wilayah Persekutuan", "merchantCountry": "MY", "currency": "MYR", "amountRange": (12.0,  130.0), "channels": ["MOBILE_APP"]},
    {"merchantId": "MER-SBUX-0001", "merchantName": "Starbucks Malaysia",    "merchantCategory": "CAFE",               "merchantCity": "Kuala Lumpur", "merchantState": "Wilayah Persekutuan", "merchantCountry": "MY", "currency": "MYR", "amountRange": (11.0,  65.0),  "channels": ["POS", "CONTACTLESS", "MOBILE_APP"]},
    {"merchantId": "MER-PZZA-0001", "merchantName": "Pizza Hut Malaysia",    "merchantCategory": "RESTAURANT",         "merchantCity": "Johor Bahru",  "merchantState": "Johor",               "merchantCountry": "MY", "currency": "MYR", "amountRange": (22.0,  160.0), "channels": ["POS", "ONLINE", "MOBILE_APP"]},
    {"merchantId": "MER-NDS-0001",  "merchantName": "Nando's Malaysia",      "merchantCategory": "RESTAURANT",         "merchantCity": "George Town",  "merchantState": "Penang",              "merchantCountry": "MY", "currency": "MYR", "amountRange": (22.0,  200.0), "channels": ["POS", "CONTACTLESS"]},
    {"merchantId": "MER-SR-0001",   "merchantName": "Secret Recipe",         "merchantCategory": "RESTAURANT",         "merchantCity": "Kuala Lumpur", "merchantState": "Wilayah Persekutuan", "merchantCountry": "MY", "currency": "MYR", "amountRange": (18.0,  150.0), "channels": ["POS", "CONTACTLESS"]},
    # Fuel & Transport
    {"merchantId": "MER-PTNS-0001", "merchantName": "Petronas Station",      "merchantCategory": "FUEL",               "merchantCity": "Petaling Jaya","merchantState": "Selangor",            "merchantCountry": "MY", "currency": "MYR", "amountRange": (25.0,  200.0), "channels": ["POS", "CONTACTLESS"]},
    {"merchantId": "MER-SHLL-0001", "merchantName": "Shell Malaysia",        "merchantCategory": "FUEL",               "merchantCity": "Shah Alam",    "merchantState": "Selangor",            "merchantCountry": "MY", "currency": "MYR", "amountRange": (25.0,  200.0), "channels": ["POS", "CONTACTLESS"]},
    {"merchantId": "MER-GRBC-0001", "merchantName": "GrabCar",              "merchantCategory": "RIDE_HAILING",       "merchantCity": "Kuala Lumpur", "merchantState": "Wilayah Persekutuan", "merchantCountry": "MY", "currency": "MYR", "amountRange": (6.0,   85.0),  "channels": ["MOBILE_APP"]},
    {"merchantId": "MER-PLUS-0001", "merchantName": "PLUS Highway Toll",    "merchantCategory": "TOLL",               "merchantCity": "Kuala Lumpur", "merchantState": "Wilayah Persekutuan", "merchantCountry": "MY", "currency": "MYR", "amountRange": (3.0,   28.0),  "channels": ["CONTACTLESS"]},
    # E-Commerce
    {"merchantId": "MER-LZD-0001",  "merchantName": "Lazada Malaysia",       "merchantCategory": "E_COMMERCE",         "merchantCity": "Kuala Lumpur", "merchantState": "Wilayah Persekutuan", "merchantCountry": "MY", "currency": "MYR", "amountRange": (12.0, 1600.0), "channels": ["ONLINE", "MOBILE_APP"]},
    {"merchantId": "MER-SHP-0001",  "merchantName": "Shopee Malaysia",       "merchantCategory": "E_COMMERCE",         "merchantCity": "Kuala Lumpur", "merchantState": "Wilayah Persekutuan", "merchantCountry": "MY", "currency": "MYR", "amountRange": (8.0,  1300.0), "channels": ["ONLINE", "MOBILE_APP"]},
    {"merchantId": "MER-ZLR-0001",  "merchantName": "Zalora Malaysia",       "merchantCategory": "FASHION_ECOMMERCE",  "merchantCity": "Kuala Lumpur", "merchantState": "Wilayah Persekutuan", "merchantCountry": "MY", "currency": "MYR", "amountRange": (45.0,  850.0), "channels": ["ONLINE", "MOBILE_APP"]},
    # Fashion & Retail
    {"merchantId": "MER-UNI-0001",  "merchantName": "Uniqlo Malaysia",       "merchantCategory": "APPAREL",            "merchantCity": "Kuala Lumpur", "merchantState": "Wilayah Persekutuan", "merchantCountry": "MY", "currency": "MYR", "amountRange": (30.0,  600.0), "channels": ["POS", "CONTACTLESS", "ONLINE"]},
    {"merchantId": "MER-ZRA-0001",  "merchantName": "Zara Malaysia",         "merchantCategory": "APPAREL",            "merchantCity": "Kuala Lumpur", "merchantState": "Wilayah Persekutuan", "merchantCountry": "MY", "currency": "MYR", "amountRange": (80.0, 1200.0), "channels": ["POS", "CONTACTLESS"]},
    # Healthcare & Pharmacy
    {"merchantId": "MER-KPJ-0001",  "merchantName": "KPJ Specialist Hospital","merchantCategory": "HEALTHCARE",        "merchantCity": "Johor Bahru",  "merchantState": "Johor",               "merchantCountry": "MY", "currency": "MYR", "amountRange": (80.0, 4500.0), "channels": ["POS"]},
    {"merchantId": "MER-WATSN-001", "merchantName": "Watson's Pharmacy",     "merchantCategory": "PHARMACY",           "merchantCity": "Ipoh",         "merchantState": "Perak",               "merchantCountry": "MY", "currency": "MYR", "amountRange": (8.0,   250.0), "channels": ["POS", "CONTACTLESS"]},
    # Digital & Entertainment
    {"merchantId": "MER-STEAM-001", "merchantName": "Steam",                 "merchantCategory": "GAMING",             "merchantCity": "Bellevue",     "merchantState": "Washington",          "merchantCountry": "US", "currency": "USD", "amountRange": (3.0,   200.0), "channels": ["ONLINE"]},
    {"merchantId": "MER-NFLX-001",  "merchantName": "Netflix",               "merchantCategory": "STREAMING",          "merchantCity": "Los Gatos",    "merchantState": "California",          "merchantCountry": "US", "currency": "USD", "amountRange": (14.99, 22.99), "channels": ["ONLINE"]},
    {"merchantId": "MER-SPLY-001",  "merchantName": "Spotify",               "merchantCategory": "STREAMING",          "merchantCity": "Stockholm",    "merchantState": "Stockholm",           "merchantCountry": "SE", "currency": "USD", "amountRange": (4.99,  15.99), "channels": ["ONLINE"]},
    {"merchantId": "MER-APPL-001",  "merchantName": "Apple Inc.",            "merchantCategory": "DIGITAL_GOODS",      "merchantCity": "Cupertino",    "merchantState": "California",          "merchantCountry": "US", "currency": "USD", "amountRange": (0.99,  999.0), "channels": ["ONLINE", "MOBILE_APP"]},
    # International Travel
    {"merchantId": "MER-AGOD-001",  "merchantName": "Agoda",                 "merchantCategory": "TRAVEL_BOOKING",     "merchantCity": "Singapore",    "merchantState": "Singapore",           "merchantCountry": "SG", "currency": "SGD", "amountRange": (120.0,2500.0), "channels": ["ONLINE"]},
    {"merchantId": "MER-AMZN-001",  "merchantName": "Amazon.com",            "merchantCategory": "E_COMMERCE",         "merchantCity": "Seattle",      "merchantState": "Washington",          "merchantCountry": "US", "currency": "USD", "amountRange": (8.0,   600.0), "channels": ["ONLINE"]},
    {"merchantId": "MER-SIA-0001",  "merchantName": "Singapore Airlines",    "merchantCategory": "AIRLINE",            "merchantCity": "Singapore",    "merchantState": "Singapore",           "merchantCountry": "SG", "currency": "SGD", "amountRange": (250.0,6000.0), "channels": ["ONLINE"]},
    {"merchantId": "MER-AA-0001",   "merchantName": "AirAsia",               "merchantCategory": "AIRLINE",            "merchantCity": "Sepang",       "merchantState": "Selangor",            "merchantCountry": "MY", "currency": "MYR", "amountRange": (75.0, 2200.0), "channels": ["ONLINE", "MOBILE_APP"]},
]

MERCHANTS_UTILITY: list[dict] = [
    {"merchantId": "MER-TM-0001",   "merchantName": "TM Unifi",              "merchantCategory": "TELECOMMUNICATIONS", "merchantCity": "Kuala Lumpur", "merchantState": "Wilayah Persekutuan", "merchantCountry": "MY", "currency": "MYR", "amountRange": (79.0,  250.0), "channels": ["ONLINE", "MOBILE_APP"]},
    {"merchantId": "MER-MXS-0001",  "merchantName": "Maxis Berhad",         "merchantCategory": "TELECOMMUNICATIONS", "merchantCity": "Kuala Lumpur", "merchantState": "Wilayah Persekutuan", "merchantCountry": "MY", "currency": "MYR", "amountRange": (28.0,  200.0), "channels": ["ONLINE", "MOBILE_APP"]},
    {"merchantId": "MER-CEL-0001",  "merchantName": "Celcom Axiata",        "merchantCategory": "TELECOMMUNICATIONS", "merchantCity": "Kuala Lumpur", "merchantState": "Wilayah Persekutuan", "merchantCountry": "MY", "currency": "MYR", "amountRange": (25.0,  180.0), "channels": ["ONLINE", "MOBILE_APP"]},
    {"merchantId": "MER-TNB-0001",  "merchantName": "Tenaga Nasional Berhad","merchantCategory": "UTILITIES",         "merchantCity": "Kuala Lumpur", "merchantState": "Wilayah Persekutuan", "merchantCountry": "MY", "currency": "MYR", "amountRange": (55.0,  420.0), "channels": ["ONLINE", "MOBILE_APP"]},
    {"merchantId": "MER-SYAB-0001", "merchantName": "Syabas Water",         "merchantCategory": "UTILITIES",          "merchantCity": "Shah Alam",    "merchantState": "Selangor",            "merchantCountry": "MY", "currency": "MYR", "amountRange": (18.0,  110.0), "channels": ["ONLINE", "MOBILE_APP"]},
    {"merchantId": "MER-COUR-0001", "merchantName": "Coursera",             "merchantCategory": "EDUCATION",          "merchantCity": "Mountain View","merchantState": "California",          "merchantCountry": "US", "currency": "USD", "amountRange": (29.0,  399.0), "channels": ["ONLINE"]},
]

MERCHANTS_EWALLET: list[dict] = [
    {"merchantId": "MER-TNG-0001",  "merchantName": "Touch 'n Go eWallet",  "merchantCategory": "EWALLET_TOPUP",      "merchantCity": "Kuala Lumpur", "merchantState": "Wilayah Persekutuan", "merchantCountry": "MY", "currency": "MYR", "amountRange": (20.0,  500.0), "channels": ["MOBILE_APP", "ONLINE"]},
    {"merchantId": "MER-BST-0001",  "merchantName": "Boost eWallet",        "merchantCategory": "EWALLET_TOPUP",      "merchantCity": "Kuala Lumpur", "merchantState": "Wilayah Persekutuan", "merchantCountry": "MY", "currency": "MYR", "amountRange": (20.0,  300.0), "channels": ["MOBILE_APP"]},
    {"merchantId": "MER-GPY-0001",  "merchantName": "GrabPay",              "merchantCategory": "EWALLET_TOPUP",      "merchantCity": "Kuala Lumpur", "merchantState": "Wilayah Persekutuan", "merchantCountry": "MY", "currency": "MYR", "amountRange": (20.0,  500.0), "channels": ["MOBILE_APP"]},
    {"merchantId": "MER-SHOPP-001", "merchantName": "ShopeePay",            "merchantCategory": "EWALLET_TOPUP",      "merchantCity": "Kuala Lumpur", "merchantState": "Wilayah Persekutuan", "merchantCountry": "MY", "currency": "MYR", "amountRange": (10.0,  300.0), "channels": ["MOBILE_APP"]},
]

MERCHANT_INTERNAL_TRANSFER: dict = {
    "merchantId":      "MER-INTL-XFER",
    "merchantName":    "PayAlert Digital Bank",
    "merchantCategory":"INTERBANK_TRANSFER",
    "merchantCity":    "Kuala Lumpur",
    "merchantState":   "Wilayah Persekutuan",
    "merchantCountry": "MY",
    "currency":        "MYR",
    "amountRange":     (20.0, 5000.0),
    "channels":        ["MOBILE_APP", "ONLINE"],
}

MERCHANTS_ATM: list[dict] = [
    {"merchantId": "ATM-MBB-0001",  "merchantName": "Maybank ATM",          "merchantCategory": "ATM_WITHDRAWAL",     "merchantCity": "Kuala Lumpur", "merchantState": "Wilayah Persekutuan", "merchantCountry": "MY", "currency": "MYR", "amountRange": (100.0, 1000.0), "channels": ["ATM"]},
    {"merchantId": "ATM-CIMB-001",  "merchantName": "CIMB ATM",             "merchantCategory": "ATM_WITHDRAWAL",     "merchantCity": "Petaling Jaya","merchantState": "Selangor",            "merchantCountry": "MY", "currency": "MYR", "amountRange": (100.0, 1500.0), "channels": ["ATM"]},
    {"merchantId": "ATM-PBB-0001",  "merchantName": "Public Bank ATM",      "merchantCategory": "ATM_WITHDRAWAL",     "merchantCity": "Johor Bahru",  "merchantState": "Johor",               "merchantCountry": "MY", "currency": "MYR", "amountRange": (100.0, 1000.0), "channels": ["ATM"]},
    {"merchantId": "ATM-RHB-0001",  "merchantName": "RHB ATM",              "merchantCategory": "ATM_WITHDRAWAL",     "merchantCity": "George Town",  "merchantState": "Penang",              "merchantCountry": "MY", "currency": "MYR", "amountRange": (100.0, 2000.0), "channels": ["ATM"]},
    {"merchantId": "ATM-DBS-SG01",  "merchantName": "DBS ATM (Singapore)",  "merchantCategory": "ATM_WITHDRAWAL",     "merchantCity": "Singapore",    "merchantState": "Singapore",           "merchantCountry": "SG", "currency": "SGD", "amountRange": (50.0,   500.0), "channels": ["ATM"]},
    {"merchantId": "ATM-CITI-US01", "merchantName": "Citibank ATM (USA)",   "merchantCategory": "ATM_WITHDRAWAL",     "merchantCity": "New York",     "merchantState": "New York",            "merchantCountry": "US", "currency": "USD", "amountRange": (100.0,  500.0), "channels": ["ATM"]},
]

# ── Transaction Types (weighted selection) ────────────────────────────────────

TX_TYPES        = ["PURCHASE", "PAYMENT",  "TRANSFER", "WITHDRAWAL", "REFUND", "TOPUP"]
TX_TYPE_WEIGHTS = [55,          18,          9,           7,            4,        7]

# ── User Agents (ONLINE / MOBILE_APP channels) ────────────────────────────────

USER_AGENTS_DESKTOP = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Firefox/125.0",
]

USER_AGENTS_MOBILE = [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124.0 Mobile",
    "Mozilla/5.0 (Linux; Android 13; Samsung Galaxy S24) AppleWebKit/537.36 Chrome/122.0 Mobile",
]

DEVICE_OS_OPTIONS = ["iOS 17.4", "iOS 16.7", "Android 14", "Android 13", "HarmonyOS 4.0"]
APP_VERSIONS      = ["3.4.1", "3.3.8", "3.2.5", "3.1.0"]

# ── Malaysian IP Prefixes ────────────────────────────────────────────────────

MY_IP_PREFIXES      = ["115.164", "180.247", "175.136", "202.185", "103.28", "60.48", "58.71"]
FOREIGN_IP_PREFIXES = ["52.79", "13.229", "104.17", "185.60", "35.198", "51.105", "20.190"]

# ── Transfer Purposes ─────────────────────────────────────────────────────────

TRANSFER_PURPOSES = [
    "Rental payment", "Loan repayment", "Family support", "Freelance payment",
    "Invoice settlement", "Goods purchase", "Personal loan repayment",
    "Shared expense", "Education fee", "Event contribution",
]

# ── Logging Setup ─────────────────────────────────────────────────────────────

def setup_logging(verbose: bool) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s  %(levelname)-8s  %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
        force=True,
    )

log = logging.getLogger("payalert.generator")

# ── Helpers ────────────────────────────────────────────────────────────────────

def now_myt() -> datetime:
    return datetime.now(tz=MYT)


def iso8601(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S%z")


def random_ip(prefixes: list[str]) -> str:
    prefix = random.choice(prefixes)
    return f"{prefix}.{random.randint(1, 254)}.{random.randint(1, 254)}"


def random_device_id() -> str:
    return "DEV-" + uuid.uuid4().hex[:16].upper()


def reference_id(dt: datetime) -> str:
    suffix = uuid.uuid4().hex[:8].upper()
    return f"PAY-{dt.strftime('%Y%m%d')}-{suffix}"


def round_to_cents(value: float) -> float:
    return round(value, 2)


def atm_round(value: float) -> float:
    """ATM withdrawals are multiples of 50."""
    rounded = round(value / 50) * 50
    return max(50.0, rounded)


def weighted_choice(population: list, weights: list[int]):
    return random.choices(population, weights=weights, k=1)[0]


# ── Risk Engine ────────────────────────────────────────────────────────────────

def calculate_risk(
    account: dict,
    merchant: dict,
    amount: float,
    currency: str,
    tx_type: str,
    channel: str,
    timestamp: datetime,
) -> tuple[int, str, list[str], bool, str | None]:
    """
    Returns (score, risk_level, flags, is_flagged, flag_reason).
    Score: 0-100. Thresholds: LOW<25, MEDIUM<50, HIGH<75, CRITICAL≤100.
    """
    score = 0
    flags: list[str] = []

    amount_myr = round(amount * FX_RATES.get(currency, 1.0), 2)
    tier_cap   = account["tierSpendCap"]

    # ── Amount risk ──────────────────────────────────────────────────────────
    if amount_myr > tier_cap * 1.5:
        score += 40
        flags.append("VERY_HIGH_AMOUNT")
    elif amount_myr > tier_cap * 0.7:
        score += 20
        flags.append("HIGH_AMOUNT")

    # ── Time-of-day risk (23:00–05:00 MYT) ──────────────────────────────────
    hour = timestamp.hour
    if hour >= 23 or hour < 5:
        score += 20
        flags.append("UNUSUAL_HOUR")

    # ── Cross-border ─────────────────────────────────────────────────────────
    if merchant.get("merchantCountry", "MY") != account["homeCountry"]:
        score += 15
        flags.append("CROSS_BORDER")

    # ── Foreign currency ─────────────────────────────────────────────────────
    if currency != "MYR":
        score += 10
        flags.append("FOREIGN_CURRENCY")

    # ── Suspicious round amount (≥RM500, divisible by 100) ──────────────────
    if currency == "MYR" and amount >= 500 and amount % 100 == 0:
        score += 8
        flags.append("ROUND_AMOUNT")

    # ── Simulated velocity breach (low-probability random injection) ─────────
    if random.random() < 0.04:
        score += 30
        flags.append("VELOCITY_BREACH")

    # ── Simulated unrecognised device ────────────────────────────────────────
    if channel == "MOBILE_APP" and random.random() < 0.06:
        score += 15
        flags.append("UNRECOGNISED_DEVICE")

    # ── International ATM withdrawal ─────────────────────────────────────────
    if tx_type == "WITHDRAWAL" and merchant.get("merchantCountry", "MY") != "MY":
        score += 25
        flags.append("INTERNATIONAL_ATM")

    score = min(score, 100)

    if score < 25:
        risk_level = "LOW"
    elif score < 50:
        risk_level = "MEDIUM"
    elif score < 75:
        risk_level = "HIGH"
    else:
        risk_level = "CRITICAL"

    is_flagged  = score >= 50
    flag_reason = " | ".join(flags) if flags else None

    return score, risk_level, flags, is_flagged, flag_reason


# ── Transaction Builder ────────────────────────────────────────────────────────

def pick_merchant(tx_type: str) -> dict:
    if tx_type == "WITHDRAWAL":
        return random.choice(MERCHANTS_ATM)
    if tx_type == "PAYMENT":
        return random.choice(MERCHANTS_UTILITY)
    if tx_type == "TOPUP":
        return random.choice(MERCHANTS_EWALLET)
    # PURCHASE / REFUND / TRANSFER all use general catalogue
    return random.choice(MERCHANTS_GENERAL)


def build_amount(merchant: dict, tx_type: str) -> float:
    lo, hi = merchant["amountRange"]
    if tx_type == "WITHDRAWAL":
        raw = random.uniform(lo, hi)
        return atm_round(raw)
    if tx_type == "REFUND":
        # Refunds are typically partial amounts
        full = round_to_cents(random.uniform(lo, hi))
        return round_to_cents(full * random.uniform(0.2, 0.8))
    return round_to_cents(random.uniform(lo, hi))


def build_description(tx_type: str, merchant: dict, account: dict, recipient: dict | None) -> str:
    name = merchant["merchantName"]
    channel_map = {
        "POS":         "Card payment",
        "CONTACTLESS": "Contactless payment",
        "ONLINE":      "Online purchase",
        "MOBILE_APP":  "In-app payment",
        "ATM":         "Cash withdrawal",
    }
    channel = merchant["channels"][0]
    action  = channel_map.get(channel, "Payment")

    if tx_type == "PURCHASE":
        return f"{action} at {name}"
    if tx_type == "PAYMENT":
        return f"Bill payment to {name}"
    if tx_type == "REFUND":
        return f"Refund from {name}"
    if tx_type == "WITHDRAWAL":
        return f"ATM cash withdrawal – {merchant['merchantCity']}, {merchant['merchantCountry']}"
    if tx_type == "TOPUP":
        return f"{name} wallet top-up"
    if tx_type == "TRANSFER" and recipient:
        return f"Fund transfer to {recipient['customerName']} ({recipient['accountId']})"
    return f"{tx_type.title()} – {name}"


def _pick_scenario(fraud_mode: bool) -> str | None:
    if fraud_mode or random.random() < 0.05:
        return random.choice(["high_amount", "late_night", "cross_border_atm", "velocity"])
    return None


def _resolve_tx_context(
    account: dict, fraud_scenario: str | None, ts: Any
) -> tuple[str, dict, str, dict | None, float, str, Any]:
    """Return (tx_type, merchant, channel, recipient, amount, currency, ts)."""
    tx_type  = weighted_choice(TX_TYPES, TX_TYPE_WEIGHTS)
    merchant = pick_merchant(tx_type)

    if fraud_scenario == "high_amount":
        tx_type  = "PURCHASE"
        merchant = random.choice(MERCHANTS_GENERAL)
    elif fraud_scenario == "late_night":
        ts = ts.replace(hour=random.randint(0, 4), minute=random.randint(0, 59))
    elif fraud_scenario == "cross_border_atm":
        tx_type  = "WITHDRAWAL"
        merchant = random.choice([m for m in MERCHANTS_ATM if m["merchantCountry"] != "MY"])
    elif fraud_scenario == "velocity":
        tx_type = "PURCHASE"

    channel  = random.choice(merchant["channels"])
    currency = merchant["currency"]
    amount   = build_amount(merchant, tx_type)

    if fraud_scenario == "high_amount":
        amount = round_to_cents(account["tierSpendCap"] * random.uniform(1.6, 3.0) / FX_RATES.get(currency, 1.0))

    recipient: dict | None = None
    if tx_type == "TRANSFER":
        others    = [a for a in ACCOUNTS if a["accountId"] != account["accountId"]]
        recipient = random.choice(others)
        currency  = "MYR"
        amount    = round_to_cents(random.uniform(20, min(account["tierSpendCap"] * 0.5, 5000)))

    return tx_type, merchant, channel, recipient, amount, currency, ts


def _build_digital_fields(channel: str, merchant: dict) -> dict[str, Any]:
    ip_prefixes = FOREIGN_IP_PREFIXES if merchant["merchantCountry"] != "MY" else MY_IP_PREFIXES
    return {
        "ip_address":  random_ip(ip_prefixes) if channel in ("ONLINE", "MOBILE_APP") else None,
        "device_id":   random_device_id()     if channel == "MOBILE_APP"             else None,
        "device_os":   random.choice(DEVICE_OS_OPTIONS) if channel == "MOBILE_APP"   else None,
        "app_version": random.choice(APP_VERSIONS)      if channel == "MOBILE_APP"   else None,
        "user_agent":  (
            random.choice(USER_AGENTS_MOBILE)  if channel == "MOBILE_APP" else
            random.choice(USER_AGENTS_DESKTOP) if channel == "ONLINE"      else None
        ),
    }


def _assemble_payload(
    *,
    account: dict,
    merchant: dict,
    tx_type: str,
    channel: str,
    amount: float,
    currency: str,
    recipient: dict | None,
    digital: dict[str, Any],
    risk_score: int,
    risk_level: str,
    risk_flags: list,
    is_flagged: bool,
    flag_reason: str,
    description: str,
    transaction_id: str,
    ref_id: str,
    ts: Any,
    fraud_scenario: str | None,
    dlq_fail_rate: float,
) -> dict[str, Any]:
    exchange_rate = FX_RATES.get(currency, 1.0)
    amount_myr    = round_to_cents(amount * exchange_rate) if currency != "MYR" else amount

    payload: dict[str, Any] = {
        "transactionId":    transaction_id,
        "accountId":        account["accountId"],
        "amount":           amount,
        "currency":         currency,
        "timestamp":        iso8601(ts),
        "merchantId":       merchant["merchantId"],
        "transactionType":  tx_type,
        "referenceId":      ref_id,
        "description":      description,
        "channel":          channel,
        "merchantName":     merchant["merchantName"],
        "merchantCategory": merchant["merchantCategory"],
        "merchantCity":     merchant["merchantCity"],
        "merchantState":    merchant["merchantState"],
        "merchantCountry":  merchant["merchantCountry"],
        "customerId":       account["customerId"],
        "customerName":     account["customerName"],
        "customerTier":     account["customerTier"],
        "cardLast4":        account["cardLast4"],
        "cardType":         account["cardType"],
        "location": {
            "city":    merchant["merchantCity"],
            "state":   merchant["merchantState"],
            "country": merchant["merchantCountry"],
        },
        "exchangeRate":     exchange_rate,
        "amountMYR":        amount_myr,
        "riskScore":        risk_score,
        "riskLevel":        risk_level,
        "riskFlags":        risk_flags,
        "isFlagged":        is_flagged,
        "flagReason":       flag_reason,
        "generatorVersion": GENERATOR_VERSION,
    }

    if digital["ip_address"]:
        payload["ipAddress"] = digital["ip_address"]
    if digital["user_agent"]:
        payload["userAgent"] = digital["user_agent"]
    if digital["device_id"]:
        payload["deviceId"]   = digital["device_id"]
        payload["deviceOS"]   = digital["device_os"]
        payload["appVersion"] = digital["app_version"]
    if recipient:
        payload["recipientAccountId"] = recipient["accountId"]
        payload["recipientName"]      = recipient["customerName"]
        payload["transferPurpose"]    = random.choice(TRANSFER_PURPOSES)
    if fraud_scenario:
        payload["fraudScenario"] = fraud_scenario
    if dlq_fail_rate > 0.0 and random.random() < dlq_fail_rate:
        payload["_forceFail"] = True

    return payload


def generate_transaction(
    target_account: dict | None = None,
    fraud_mode: bool = False,
    dlq_fail_rate: float = 0.0,
) -> dict[str, Any]:
    """Build a single enriched transaction payload."""
    account        = target_account or random.choice(ACCOUNTS)
    ts             = now_myt()
    fraud_scenario = _pick_scenario(fraud_mode)

    tx_type, merchant, channel, recipient, amount, currency, ts = _resolve_tx_context(
        account, fraud_scenario, ts
    )

    transaction_id = str(uuid.uuid4())
    ref_id         = reference_id(ts)
    digital        = _build_digital_fields(channel, merchant)
    description    = build_description(tx_type, merchant, account, recipient)

    risk_score, risk_level, risk_flags, is_flagged, flag_reason = calculate_risk(
        account, merchant, amount, currency, tx_type, channel, ts
    )

    return _assemble_payload(
        account=account,
        merchant=merchant,
        tx_type=tx_type,
        channel=channel,
        amount=amount,
        currency=currency,
        recipient=recipient,
        digital=digital,
        risk_score=risk_score,
        risk_level=risk_level,
        risk_flags=risk_flags,
        is_flagged=is_flagged,
        flag_reason=flag_reason,
        description=description,
        transaction_id=transaction_id,
        ref_id=ref_id,
        ts=ts,
        fraud_scenario=fraud_scenario,
        dlq_fail_rate=dlq_fail_rate,
    )


# ── SQS Sender ─────────────────────────────────────────────────────────────────

def build_sqs_client(region: str):
    return boto3.client("sqs", region_name=region)


def send_batch(sqs_client, queue_url: str, messages: list[dict]) -> tuple[int, int]:
    """
    Sends up to 10 messages in a single SQS batch call.
    Returns (sent_count, failed_count).
    """
    entries = [
        {
            "Id":          str(i),
            "MessageBody": json.dumps(msg, ensure_ascii=False),
        }
        for i, msg in enumerate(messages)
    ]
    try:
        response = sqs_client.send_message_batch(QueueUrl=queue_url, Entries=entries)
    except ClientError as exc:
        log.error("SQS batch send failed: %s", exc)
        return 0, len(messages)

    sent   = len(response.get("Successful",  []))
    failed = len(response.get("Failed",      []))

    for fail in response.get("Failed", []):
        log.warning(
            "Message %s rejected: [%s] %s",
            fail.get("Id"), fail.get("Code"), fail.get("Message"),
        )
    return sent, failed


# ── Main Loop ─────────────────────────────────────────────────────────────────

def run_stream(
    sqs_client,
    queue_url: str,
    min_interval: float,
    max_interval: float,
    burst_min: int,
    burst_max: int,
    target_account: dict | None,
    fraud_mode: bool,
    dry_run: bool,
) -> None:
    total_sent = 0
    total_fail = 0

    log.info(
        "Starting stream | interval=[%.1fs–%.1fs] burst=[%d–%d] fraud_mode=%s dry_run=%s",
        min_interval, max_interval, burst_min, burst_max, fraud_mode, dry_run,
    )

    while True:
        burst_size = random.randint(burst_min, burst_max)
        messages   = [generate_transaction(target_account, fraud_mode) for _ in range(burst_size)]

        if dry_run:
            for msg in messages:
                print(json.dumps(msg, indent=2, ensure_ascii=False))
            log.info("[DRY-RUN] Generated %d transaction(s)", burst_size)
        else:
            # SQS batch size limit is 10
            for chunk_start in range(0, len(messages), 10):
                chunk       = messages[chunk_start:chunk_start + 10]
                sent, fail  = send_batch(sqs_client, queue_url, chunk)
                total_sent += sent
                total_fail += fail

                if sent:
                    ids = [m["transactionId"][:8] for m in chunk[:sent]]
                    log.info(
                        "Sent %d tx | IDs: %s | total_sent=%d fail=%d",
                        sent, ids, total_sent, total_fail,
                    )

        sleep_sec = random.uniform(min_interval, max_interval)
        log.debug("Sleeping %.2fs before next burst", sleep_sec)
        time.sleep(sleep_sec)


def run_batch(
    sqs_client,
    queue_url: str,
    count: int,
    target_account: dict | None,
    fraud_mode: bool,
    dry_run: bool,
) -> None:
    log.info("Batch mode | count=%d fraud_mode=%s dry_run=%s", count, fraud_mode, dry_run)

    messages   = [generate_transaction(target_account, fraud_mode) for _ in range(count)]
    total_sent = 0
    total_fail = 0

    for chunk_start in range(0, len(messages), 10):
        chunk = messages[chunk_start:chunk_start + 10]

        if dry_run:
            for msg in chunk:
                print(json.dumps(msg, indent=2, ensure_ascii=False))
        else:
            sent, fail  = send_batch(sqs_client, queue_url, chunk)
            total_sent += sent
            total_fail += fail

    if dry_run:
        log.info("[DRY-RUN] Generated %d transaction(s)", count)
    else:
        log.info("Batch complete | sent=%d failed=%d", total_sent, total_fail)


# ── CLI ───────────────────────────────────────────────────────────────────────

def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="generator.py",
        description="PayAlert Transaction Generator – pushes enriched transactions to SQS.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Continuous streaming (requires SQS_QUEUE_URL env var):
  python generator.py

  # Stream with explicit queue URL and slower pace:
  python generator.py --queue-url https://sqs.ap-southeast-1.amazonaws.com/123/queue \\
                      --min-interval 1.0 --max-interval 5.0

  # Generate 50 transactions for a specific account without sending:
  python generator.py --mode batch --count 50 --account ACC-MY-4F291A3B --dry-run

  # Fraud injection mode for audit portal demonstration:
  python generator.py --fraud-mode --min-interval 0.5 --max-interval 1.5
""",
    )
    parser.add_argument("--mode",         choices=["stream", "batch"], default="stream",
                        help="Run mode (default: stream)")
    parser.add_argument("--count",        type=int, default=20,
                        help="Number of transactions for batch mode (default: 20)")
    parser.add_argument("--queue-url",    default=SQS_QUEUE_URL,
                        help="SQS queue URL (env: SQS_QUEUE_URL)")
    parser.add_argument("--region",       default=AWS_REGION,
                        help="AWS region (env: AWS_REGION, default: ap-southeast-1)")
    parser.add_argument("--min-interval", type=float, default=MIN_INTERVAL,
                        help="Min seconds between bursts in stream mode (default: 0.1)")
    parser.add_argument("--max-interval", type=float, default=MAX_INTERVAL,
                        help="Max seconds between bursts in stream mode (default: 2.0)")
    parser.add_argument("--burst-min",    type=int, default=BURST_MIN,
                        help="Min transactions per burst (default: 1)")
    parser.add_argument("--burst-max",    type=int, default=BURST_MAX,
                        help="Max transactions per burst (default: 5)")
    parser.add_argument("--account",      default=None,
                        help="Restrict to a single accountId (e.g. ACC-MY-4F291A3B)")
    parser.add_argument("--fraud-mode",   action="store_true",
                        help="Inject fraud scenarios at elevated frequency (~30%% of transactions)")
    parser.add_argument("--dry-run",      action="store_true",
                        help="Print JSON to stdout without sending to SQS")
    parser.add_argument("--verbose",      action="store_true",
                        help="Enable debug-level logging")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    setup_logging(args.verbose)

    # Resolve target account
    target_account: dict | None = None
    if args.account:
        matches = [a for a in ACCOUNTS if a["accountId"] == args.account]
        if not matches:
            log.error("Unknown accountId '%s'. Valid accounts: %s",
                      args.account, [a["accountId"] for a in ACCOUNTS])
            return 1
        target_account = matches[0]
        log.info("Pinned to account: %s (%s)", target_account["accountId"],
                 target_account["customerName"])

    # Validate queue URL
    if not args.dry_run and not args.queue_url:
        log.error(
            "SQS queue URL is required. Set SQS_QUEUE_URL env var or pass --queue-url. "
            "Use --dry-run to test without SQS."
        )
        return 1

    # Build SQS client
    sqs_client = None
    if not args.dry_run:
        try:
            sqs_client = build_sqs_client(args.region)
            log.info("SQS client ready | region=%s queue=%s", args.region, args.queue_url)
        except NoCredentialsError:
            log.error("AWS credentials not found. Configure via IAM role, env vars, or ~/.aws/credentials.")
            return 1

    if args.mode == "batch":
        run_batch(
            sqs_client, args.queue_url, args.count,
            target_account, args.fraud_mode, args.dry_run,
        )
    else:
        try:
            run_stream(
                sqs_client, args.queue_url,
                args.min_interval, args.max_interval,
                args.burst_min, args.burst_max,
                target_account, args.fraud_mode, args.dry_run,
            )
        except KeyboardInterrupt:
            log.info("Stream interrupted by user. Shutting down.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
