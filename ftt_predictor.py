import sys
import json
import pickle
import numpy as np
import pandas as pd
from scipy.stats import skew, kurtosis
from statsmodels.tsa.stattools import acf
from scipy.signal import detrend

import os
from pathlib import Path
DEBUG = os.getenv("FTT_DEBUG", "0") == "1"

def teager_kaiser_energy(signal):
    """ Compute Teager-Kaiser Energy Operator (TKEO) """
    if len(signal) < 3:
        return 0.0
    return np.mean(signal[1:-1]**2 - signal[:-2] * signal[2:])

def detrended_fluctuation_analysis(signal):
    """ Compute Detrended Fluctuation Analysis (DFA) """
    if len(signal) < 5:
        return 0.0
    y = np.cumsum(signal - np.mean(signal))
    detrended = detrend(y)
    return np.std(detrended)

def extract_features(tap_intervals, tap_positions=None):
    """
    Extract features from tap interval data and optional position data
    
    Parameters:
    tap_intervals (list): List of time intervals between taps
    tap_positions (list): Optional list of dictionaries with x, y coordinates
    
    Returns:
    dict: Dictionary of computed features
    """
    # Convert to numpy array if not already
    tap_intervals = np.array(tap_intervals, dtype=float)
    
    features = {}
    
    # Handle empty or single-element arrays
    if len(tap_intervals) < 2:
        return {feature: 0.0 for feature in [
            "meanTapInter", "medianTapInter", "iqrTapInter", "minTapInter", "maxTapInter",
            "skewTapInter", "kurTapInter", "sdTapInter", "madTapInter", "cvTapInter",
            "rangeTapInter", "tkeoTapInter", "dfaTapInter", "ar1TapInter", "ar2TapInter",
            "fatigue10TapInter", "fatigue25TapInter", "fatigue50TapInter"
        ]}
    
    # Tap interval statistics
    features["meanTapInter"] = np.mean(tap_intervals)
    features["medianTapInter"] = np.median(tap_intervals)
    features["iqrTapInter"] = np.percentile(tap_intervals, 75) - np.percentile(tap_intervals, 25)
    features["minTapInter"] = np.min(tap_intervals)
    features["maxTapInter"] = np.max(tap_intervals)
    features["skewTapInter"] = float(skew(tap_intervals))
    features["kurTapInter"] = float(kurtosis(tap_intervals))
    features["sdTapInter"] = np.std(tap_intervals)
    features["madTapInter"] = np.median(np.abs(tap_intervals - np.median(tap_intervals)))
    features["cvTapInter"] = features["sdTapInter"] / features["meanTapInter"] if features["meanTapInter"] > 0 else 0
    features["rangeTapInter"] = features["maxTapInter"] - features["minTapInter"]
    features["tkeoTapInter"] = teager_kaiser_energy(tap_intervals)
    features["dfaTapInter"] = detrended_fluctuation_analysis(tap_intervals)
    
    # Autoregressive coefficients
    if len(tap_intervals) > 2:
        try:
            ar_coeffs = acf(tap_intervals, nlags=2, fft=False)
            features["ar1TapInter"] = float(ar_coeffs[1]) if len(ar_coeffs) > 1 else 0.0
            features["ar2TapInter"] = float(ar_coeffs[2]) if len(ar_coeffs) > 2 else 0.0
        except:
            features["ar1TapInter"], features["ar2TapInter"] = 0.0, 0.0
    else:
        features["ar1TapInter"], features["ar2TapInter"] = 0.0, 0.0
    
    # Fatigue metrics
    n = len(tap_intervals)
    if n >= 10:
        features["fatigue10TapInter"] = np.mean(tap_intervals[:max(1, int(n*0.1))]) - np.mean(tap_intervals[-max(1, int(n*0.1)):])
    else:
        features["fatigue10TapInter"] = 0.0
        
    if n >= 4:
        features["fatigue25TapInter"] = np.mean(tap_intervals[:max(1, int(n*0.25))]) - np.mean(tap_intervals[-max(1, int(n*0.25)):])
    else:
        features["fatigue25TapInter"] = 0.0
        
    if n >= 2:
        features["fatigue50TapInter"] = np.mean(tap_intervals[:max(1, int(n*0.5))]) - np.mean(tap_intervals[-max(1, int(n*0.5)):])
    else:
        features["fatigue50TapInter"] = 0.0
    
    # If tap positions are provided, calculate drift features
    if tap_positions:
        # Extract x and y coordinates
        x_coords = [pos.get('x', 0) for pos in tap_positions]
        y_coords = [pos.get('y', 0) for pos in tap_positions]
        
        # Compute drift from median tap position
        median_x, median_y = np.median(x_coords), np.median(y_coords)
        drift = np.sqrt([(x - median_x)**2 + (y - median_y)**2 for x, y in zip(x_coords, y_coords)])
        
        # For now, we'll calculate the overall drift features
        # In a real app, you'd split by hand as in the original code
        
        for prefix in ["DriftLeft", "DriftRight"]:
            features[f"mean{prefix}"] = np.mean(drift) if len(drift) > 0 else 0.0
            features[f"median{prefix}"] = np.median(drift) if len(drift) > 0 else 0.0
            features[f"iqr{prefix}"] = (np.percentile(drift, 75) - np.percentile(drift, 25)) if len(drift) > 0 else 0.0
            features[f"min{prefix}"] = np.min(drift) if len(drift) > 0 else 0.0
            features[f"max{prefix}"] = np.max(drift) if len(drift) > 0 else 0.0
            features[f"skew{prefix}"] = float(skew(drift)) if len(drift) > 1 else 0.0
            features[f"kur{prefix}"] = float(kurtosis(drift)) if len(drift) > 1 else 0.0
            features[f"sd{prefix}"] = np.std(drift) if len(drift) > 0 else 0.0
            features[f"mad{prefix}"] = np.median(np.abs(drift - np.median(drift))) if len(drift) > 0 else 0.0
            features[f"cv{prefix}"] = (features[f"sd{prefix}"] / features[f"mean{prefix}"]) if features[f"mean{prefix}"] > 0 else 0.0
            features[f"range{prefix}"] = (features[f"max{prefix}"] - features[f"min{prefix}"]) if len(drift) > 0 else 0.0
        
        # Other statistics
        features["numberTaps"] = len(tap_positions)
        features["buttonNoneFreq"] = 0.0  # Not available in our data structure
        
        
        if tap_positions and DEBUG:
            # Debug information
            print("DEBUG x_coords:", x_coords[:5], "length:", len(x_coords), file=sys.stderr)
            print("DEBUG y_coords:", y_coords[:5], "length:", len(y_coords), file=sys.stderr)
            print("DEBUG unique x values:", len(set(x_coords)), file=sys.stderr)
            print("DEBUG unique y values:", len(set(y_coords)), file=sys.stderr)
            
            # Check for invalid values
            x_has_nan = any(np.isnan(x) for x in x_coords)
            y_has_nan = any(np.isnan(y) for y in y_coords)
            print("DEBUG x has NaN:", x_has_nan, file=sys.stderr)
            print("DEBUG y has NaN:", y_has_nan, file=sys.stderr)
            
            # Compute variance
            x_var = np.var(x_coords)
            y_var = np.var(y_coords)
            print("DEBUG x variance:", x_var, file=sys.stderr)
            print("DEBUG y variance:", y_var, file=sys.stderr)
            
            # Try calculating correlation with safeguards
            try:
                if x_var > 0 and y_var > 0:
                    corr_matrix = np.corrcoef(x_coords, y_coords)
                    corr_value = float(corr_matrix[0, 1])
                    print("DEBUG correlation value:", corr_value, file=sys.stderr)
                    features["corXY"] = 0.0 if np.isnan(corr_value) else corr_value
                else:
                    print("DEBUG zero variance detected, setting corXY to 0", file=sys.stderr)
                    features["corXY"] = 0.0
            except Exception as e:
                print("DEBUG correlation calculation error:", str(e), file=sys.stderr)
                features["corXY"] = 0.0

        # features["corXY"] = float(np.corrcoef(x_coords, y_coords)[0, 1]) if len(x_coords) > 1 else 0.0
    

    
    else:
        # If no position data, set default values for position-related features
        for prefix in ["DriftLeft", "DriftRight"]:
            for stat in ["mean", "median", "iqr", "min", "max", "skew", "kur", "sd", "mad", "cv", "range"]:
                features[f"{stat}{prefix}"] = 0.0
        
        features["numberTaps"] = len(tap_intervals) + 1  # Approximate from intervals
        features["buttonNoneFreq"] = 0.0
        features["corXY"] = 0.0
    
    return features

def predict_ftt_abnormality(data, model_path= None, 
                          feature_names_path=None):
    base_dir = Path(__file__).resolve().parent  # kppdcalc_20260208/ 가정
    model_path = Path(model_path) if model_path else (base_dir / "xgb_ftt_model.pkl")
    feature_names_path = Path(feature_names_path) if feature_names_path else (base_dir / "feature_names.pkl")

    """
    Predict abnormality from FFT data
    
    Parameters:
    data (dict): Dictionary containing tap intervals and optional positions
    model_path (str): Path to the saved model
    feature_names_path (str): Path to saved feature names
    
    Returns:
    dict: Prediction result including abnormal status and probability
    """
    try:
        # Load model and feature names
        model = pickle.load(open(model_path, 'rb'))
        feature_names = pickle.load(open(feature_names_path, 'rb'))
        
        # Extract tap intervals and positions from input data
        tap_intervals = data.get('tap_intervals', [])
        
        # Convert string tap intervals to float if needed
        if tap_intervals and isinstance(tap_intervals[0], str):
            tap_intervals = [float(x) for x in tap_intervals]
        
        # Get tap positions if available
        tap_positions = data.get('tap_positions', None)
        
        # Extract features using the improved function
        input_data = extract_features(tap_intervals, tap_positions)
        
        # Create DataFrame with the features
        df = pd.DataFrame([input_data])
        
        # Ensure all required features are present
        for feature in feature_names:
            if feature not in df.columns:
                df[feature] = 0.0  # Default value for missing features
        
        # Select only required features in correct order
        df = df[feature_names]
        
        # Replace any infinite values with 0
        df = df.replace([np.inf, -np.inf], 0)
        
        # Fill any NaN values with 0
        df = df.fillna(0)
        
        # Make prediction
        probability = float(model.predict_proba(df)[0, 1])
        prediction = int(probability >= 0.5)
        
        return {
            'success': True,
            'abnormal': prediction,
            'probability': probability,
            'features_used': len(feature_names),
            'features_available': len(input_data),
            'computed_features': input_data
        }
        
    except Exception as e:
        import traceback
        return {
            'success': False,
            'error': str(e),
            'traceback': traceback.format_exc()
        }

if __name__ == "__main__":
    # Read input from stdin (used when called from Node.js)
    input_data = json.loads(sys.stdin.read())
    result = predict_ftt_abnormality(input_data)
    sys.stdout.write(json.dumps(result))
    sys.stdout.flush()
    
    # Output JSON result to stdout
    print(json.dumps(result))