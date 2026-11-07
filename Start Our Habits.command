#!/bin/bash
cd "$(dirname "$0")"
export PYTHONUNBUFFERED=1
echo "Keep this window open while you use Habit Tracker."
python3 server.py
