# app.py - Flask Backend for DialLens OCR Phone Number Extractor
import re
import base64
import logging
from flask import Flask, render_template, request, jsonify
from PIL import Image
import pytesseract
import io

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# Regex patterns for phone number detection
# Kenyan format: +254XXXXXXXXX, 07XXXXXXXX, 01XXXXXXXX, 254XXXXXXXXX
# International format: + followed by 7-15 digits
PHONE_REGEX_PATTERNS = [
    r'\+\d{1,3}\s?\d{3}\s?\d{3}\s?\d{4}',  # International: +XXX XXX XXX XXXX
    r'\+254\d{9}',                           # Kenyan international: +254XXXXXXXXX
    r'07\d{8}',                              # Kenyan: 07XXXXXXXX
    r'01\d{8}',                              # Kenyan: 01XXXXXXXX (Safaricom, etc)
    r'254\d{9}',                             # Kenyan without plus: 254XXXXXXXXX
    r'\d{3}\s?\d{3}\s?\d{4}',               # Local: XXX XXX XXXX
    r'0\d{9}',                               # Any 10-digit starting with 0
]

def extract_phone_numbers(text):
    """
    Extract phone numbers from text using regex patterns.
    Returns list of unique phone numbers.
    """
    if not text:
        return []
    
    phone_numbers = set()
    
    for pattern in PHONE_REGEX_PATTERNS:
        matches = re.findall(pattern, text)
        for match in matches:
            # Clean the number: remove spaces, normalize
            cleaned = re.sub(r'\s+', '', match)
            # Validate length (between 9 and 15 digits)
            if 9 <= len(cleaned) <= 15:
                phone_numbers.add(cleaned)
    
    # Sort for consistent display
    return sorted(list(phone_numbers))

def process_image(image_data):
    """
    Process image data: decode base64, run OCR, extract phone numbers.
    Returns list of detected phone numbers.
    """
    try:
        # Remove data URL prefix if present
        if ',' in image_data:
            image_data = image_data.split(',')[1]
        
        # Decode base64 to bytes
        image_bytes = base64.b64decode(image_data)
        
        # Open image with PIL
        image = Image.open(io.BytesIO(image_bytes))
        
        # Optional: Preprocess image for better OCR
        # Convert to RGB if needed
        if image.mode not in ('L', 'RGB'):
            image = image.convert('RGB')
        
        # Run OCR using pytesseract
        # Use English language, with config for better accuracy
        custom_config = r'--oem 3 --psm 6'
        extracted_text = pytesseract.image_to_string(image, config=custom_config)
        
        logger.info(f"OCR extracted text: {extracted_text[:200]}...")
        
        # Extract phone numbers
        phone_numbers = extract_phone_numbers(extracted_text)
        
        logger.info(f"Found phone numbers: {phone_numbers}")
        
        return phone_numbers
        
    except Exception as e:
        logger.error(f"Error processing image: {str(e)}")
        raise e

@app.route('/')
def index():
    """Serve the main page"""
    return render_template('index.html')

@app.route('/scan', methods=['POST'])
def scan_image():
    """
    Receive image from frontend, process OCR, return detected phone numbers.
    Expects JSON with 'image' field containing base64 image data.
    """
    try:
        data = request.get_json()
        
        if not data or 'image' not in data:
            return jsonify({'error': 'No image data provided'}), 400
        
        image_data = data['image']
        
        # Process the image
        phone_numbers = process_image(image_data)
        
        if phone_numbers:
            return jsonify({
                'success': True,
                'numbers': phone_numbers,
                'count': len(phone_numbers)
            })
        else:
            return jsonify({
                'success': True,
                'numbers': [],
                'count': 0,
                'message': 'No phone numbers detected. Please try again with a clearer image.'
            })
            
    except Exception as e:
        logger.error(f"Scan endpoint error: {str(e)}")
        return jsonify({'error': f'Processing failed: {str(e)}'}), 500

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)