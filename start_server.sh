#!/bin/bash
cd testing
python3 -m http.server 8080 &
echo $! > server_pid.txt
