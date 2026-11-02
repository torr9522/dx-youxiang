$0 ~ /^\// || $0 ~ /(^|\/)\.\.($|\/)/ { unsafe = 1 }
END { exit unsafe ? 1 : 0 }
