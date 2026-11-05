#!/bin/bash
cd "$(dirname "$0")"
export PYTHONUNBUFFERED=1
echo "Keep this window open while you use Our Habits."
python3 server.py
