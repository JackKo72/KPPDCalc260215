const xlsx = require('xlsx');

async function exportSurveyToExcel(db, surveyId) {
    try {
        console.log('Starting export for surveyId:', surveyId);
        
        // Get the latest version for this survey
        const [versionInfo] = await db.execute(
            'SELECT version FROM survey_responses WHERE id = ? ORDER BY version DESC LIMIT 1',
            [surveyId]
        );
        
        if (!versionInfo || versionInfo.length === 0) {
            throw new Error(`No version information found for survey ID: ${surveyId}`);
        }
        
        const latestVersion = versionInfo[0].version;
        console.log(`Using latest version: ${latestVersion} for survey ID: ${surveyId}`);

        // Fetch data from different tables with specific version
        const [surveyResponses] = await db.execute(
            'SELECT * FROM survey_responses WHERE id = ? AND version = ?', 
            [surveyId, latestVersion]
        );
        console.log('Survey Responses:', surveyResponses);

        const [surveyAnswers] = await db.execute(
            'SELECT * FROM survey_answers WHERE survey_id = ? AND version = ?', 
            [surveyId, latestVersion]
        );
        console.log('Survey Answers:', surveyAnswers);

        // Get general questions
        const [questions] = await db.execute('SELECT * FROM questions');

        // Get UPDRS questions and answers
        const [questionsUpdrs] = await db.execute('SELECT * FROM questions_updrs');
        const [answersUpdrs] = await db.execute(
            'SELECT * FROM answers_updrs WHERE survey_id = ? AND version = ?',
            [surveyId, latestVersion]
        );
        console.log('UPDRS Answers:', answersUpdrs);
        
        // Get FFT metadata
        const [fftMetadata] = await db.execute(
            'SELECT * FROM fft_metadata WHERE survey_id = ? AND version = ? ORDER BY created_at DESC LIMIT 1',
            [surveyId, latestVersion]
        );
        console.log('FFT Metadata:', fftMetadata);

        // Static consent text from agreementPage (main.html)
        const consentData = [
            {
                섹션: '1. 연구대상자 설명문',
                항목: '제목',
                내용: '연구대상자 설명문 및 온라인 동의서 (임상연구심사위원회(HUSHHIRB)/기관생명윤리위원회 승인 Version 1.2)'
            },
            {
                섹션: '1. 연구대상자 설명문',
                항목: '1. 임상 연구 제목',
                내용: '한국형 파킨슨병 전구기 설문지를 통한 파킨슨병 위험군 스크리닝'
            },
            {
                섹션: '1. 연구대상자 설명문',
                항목: '2. 시험 책임자',
                내용: '[본원 연구책임자] 김영은 교수 (소속: 한림대학교성심병원 신경과)\n[공동연구자] 한림대학교성심병원 신경과 마효일 교수 / 한림대학교성심병원 가정의학과 부교수 노혜미 / 한림대학교성심병원 신경과 곽인희 임상강사\n[연구담당자] 한림대학교 성심병원 신경과 이지연 연구간호사'
            },
            {
                섹션: '1. 연구대상자 설명문',
                항목: '3. 개요',
                내용: '이 연구는 전구기 파킨슨병 설문을 통해 연구에 참여한 분들의 파킨슨병 위험요인 분포를 확인하고 위험도를 평가하기 위한 연구입니다. 귀하는 신경과 또는 가정의학과를 방문한 대상으로서 진료과에 비치된 QR코드를 통해 자발적으로 온라인 설문조사에 참여하였습니다.'
            },
            {
                섹션: '1. 연구대상자 설명문',
                항목: '4. 임상시험의 배경과 목적',
                내용: '본 연구의 목적은 전구기 파킨슨병 설문을 통해 연구에 참여한 분들의 파킨슨병 위험요인 분포를 확인하고 파킨슨병 위험도를 평가하기 위한 연구입니다. 이를 통해 파킨슨병 고위험군을 스크리닝하여 조기 진단에 도움을 주고, 전구기 파킨슨병 환자에 대한 기초 자료를 수집하고자 합니다.\n\n파킨슨병은 긴 유병기간을 가지면서 점차 악화되는 신경계 퇴행성 질환입니다. 파킨슨병 진단기준에 부합하는 운동증상이 나타나기 전에 비운동증상만 있는 전구기 단계를 거칩니다. 전구기에 나타나는 비운동증상으로는 변비, 렘수면 행동 장애, 후각 저하, 우울증, 과도한 주간 졸음이 특징적입니다. 비운동증상이 발생한 후 파킨슨병 운동 증상이 나타나기까지 약 5-20년의 지연 기간이 있습니다.\n\n세계적으로 활발하게 연구를 진행하고 있으나 파킨슨병의 질병 수정 치료제(disease modifying treatment)는 아직 존재하지 않습니다. 전구기 파킨슨병 진단 및 파킨슨병 고위험군 스크리닝은 질병 수정 치료제의 개발과 질병 수정 치료제 임상시험에서 치료 효과를 평가하는 측면에서 매우 중요합니다.'
            },
            {
                섹션: '1. 연구대상자 설명문',
                항목: '5. 연구 약물',
                내용: '해당사항 없음'
            },
            {
                섹션: '1. 연구대상자 설명문',
                항목: '6. 연구방법',
                내용: '[연구절차] 귀하는 신경과 또는 가정의학과 외래에 방문한 환자를 대상으로, 진료과에 비치된 QR코드를 통해 자발적으로 참여하는 온라인 설문조사 연구이다. 연구 대상자는 개인 스마트기기를 이용하여 QR코드를 스캔 또는 주소로 설문에 접속하며, 설문 시작 전 본 연구에 대한 충분한 설명을 제공받는다.\n[연구대상자] 총 연구 참여대상자는 건강검진센터를 방문한 30세 이상의 연령을 대상으로 합니다. 총 2100명을 예상하며, 약 3년간 (~2027년 12월 경까지) 모집 예정입니다.'
            },
            {
                섹션: '1. 연구대상자 설명문',
                항목: '7. 연구대상자에게 예견되는 이득',
                내용: '이 연구로 여러분이 직접적인 이익을 보지 못할 수도 있습니다. 하지만 여러분께서 참여하여 주신 연구 자료의 정보를 이용하여 더 빠른 파킨슨병 진단과 더 나은 파킨슨병 치료제 개발에 이용될 수 있습니다. 이 연구에 참여하더라도 금전적인 보상은 없습니다.'
            },
            {
                섹션: '1. 연구대상자 설명문',
                항목: '8. 연구의 중도 탈락',
                내용: '설문을 진행할 때 귀하의 상태를 정확하게 기입하는 것 외 준수하셔야 할 사항은 없습니다. 본 연구는 어디까지나 본인의 자발적인 의사에 의하여 참여를 결정하는 것입니다. 그리고 연구를 위한 자료를 제공하신 이후에도 언제라도 참여 취소를 하실 수 있으며 이로 인한 불이익은 전혀 없습니다.'
            },
            {
                섹션: '1. 연구대상자 설명문',
                항목: '9. 연구 관련 새로운 정보의 지속적 제공',
                내용: '본 연구 진행 시 기여자와 관련된 새로운 정보가 있다면 얻게 되는 즉시 귀하 또는 귀하의 대리인에게 알려 드릴 것입니다.'
            },
            {
                섹션: '1. 연구대상자 설명문',
                항목: '10. 연구대상자에게 예견되는 부작용, 위험과 불편함',
                내용: '본 연구는 설문지 작성에 수반되는 불편 외 추가적인 위험, 부작용, 불편은 없습니다. 연구에 참여함으로써 대상자에게 예상되는 비용은 없으며, 손실에 대한 보상은 해당 사항이 없습니다.'
            },
            {
                섹션: '1. 연구대상자 설명문',
                항목: '11. 비밀 보장',
                내용: '귀하가 본 연구에 참여하시게 되면, 설문지 작성 중복 여부를 확인하기 위해 시행자의 전화번호와 시행일자를 수집합니다. 여러분의 신원을 파악할 수 있는 기록은 개인을 식별할 수 없도록 암호화하여 관리되며 비밀로 보호됩니다. 데이터는 여러분의 성명을 가린 채로 제공되기 때문에 자료상으로 여러분이 어디에 사는 누구인지, 어떤 사람인지 알 수 없습니다.'
            },
            {
                섹션: '1. 연구대상자 설명문',
                항목: '12. 자발적 참여',
                내용: '본 연구에 참여하시는 것은 귀하에게 달려 있습니다. 귀하는 언제든지 연구에 참여하지 않기로 결정할 수 있고 또한 연구를 그만 둘 수 있습니다. 귀하가 본 연구에 참여하지 않아도 아무런 불이익을 받지 않으며 귀하의 결정은 향후 귀하가 진료를 받는 것에 영향을 미치지 않습니다.'
            },
            {
                섹션: '1. 연구대상자 설명문',
                항목: '13. 임상시험 관련 책임자 및 연락처',
                내용: '연구책임자: 신경과 김영은 교수 (031-380-3740), 소속: 한림대학교성심병원 신경과, 주소: [14068] 경기도 안양시 동안구 관평로 170 번길 22(평촌동 896)\n한림대학교성심병원 임상시험심사위원회: 031-380-1975\n한림대학교성심병원 임상연구보호실: 031-380-4775'
            },
            {
                섹션: '2. 개인정보 제공 동의',
                항목: '개인 정보의 제공에 대한 동의사항',
                내용: '귀하의 자료는 향후의 다른 연구에서도 사용하여 더 좋은 결과를 얻을 수 있습니다. 귀하의 자료를 향후의 다른 연구에 사용하는 것과 관련하여, 본 연구의 연구자는 현행 법률과 규정이 허용하는 범위 내에서 귀하의 개인정보를 수집하고 처리합니다.'
            },
            {
                섹션: '3. 연구대상자 동의서',
                항목: '연구대상자 동의서',
                내용: '본인은 본 연구에 대한 온라인 설명문을 충분히 읽고 이해하였으며, 필요한 정보를 제공받았습니다.\n본인은 위험과 이득에 관하여 들었으며 나의 질문에 만족할 만한 답변을 얻었습니다.\n본인은 이 연구에 참여하는 것에 대하여 전자적 방식(\'동의함\' 선택)으로 자발적으로 동의합니다.\n본인은 이후의 치료에 영향을 받지 않고 언제든지 연구의 참여를 거부하거나 연구의 참여를 중도에 철회할 수 있고 이러한 결정이 나에게 어떠한 해가 되지 않을 것이라는 것을 알고 있습니다.\n본인은 이 설명서 및 동의서에 동의함으로써 의학 연구 목적으로 나의 개인정보가 현행 법률과 규정이 허용하는 범위 내에서 연구자가 수집하고 처리하는데 동의합니다.\n본인은 본 설명문 및 동의서의 내용을 언제든지 확인하거나 저장(다운로드)할 수 있음을 안내받았습니다.\n본인은 신경과 또는 가정의학과 외래를 방문한 환자로서 본인이 직접 설문에 참여함을 확인합니다.'
            }
        ];
        console.log('Consent Data:', consentData);

        // Get survey information
        const surveyInfo = surveyResponses[0];
        if (!surveyInfo) {
            throw new Error('Survey information not found');
        }
        
        // Calculate totalLR and posterior probability
        // Start with gender multiplier
        let totalLR = surveyInfo.sex === 'M' ? 1.2 : 0.8;
        
        // Calculate from survey answers
        const [lrRows] = await db.execute(
            `SELECT EXP(SUM(LOG(sa.weight))) as totalLR 
            FROM survey_answers sa
            WHERE sa.survey_id = ? AND sa.version = ?`,
            [surveyId, latestVersion]
        );
        
        // Multiply by the answer weights if we have any
        if (lrRows[0].totalLR !== null) {
            totalLR *= lrRows[0].totalLR;
        }
        
        // Apply UPDRS multiplier if available
        if (answersUpdrs.length > 0) {
            totalLR *= answersUpdrs[0].actual_weight;
        }
        
        // Apply FFT weight if available
        if (fftMetadata.length > 0) {
            totalLR *= fftMetadata[0].ftt_weight;
        }

        // Get age and calculate posterior probability
        const age = surveyInfo.age;
        const { thresholdLR, priorProb } = determineThresholdLR(age);
        const priorOdds = priorProb / (1 - priorProb);
        const postOdds = priorOdds * totalLR;
        const postProb = postOdds / (1 + postOdds);
        
        // Convert to percentage for display
        const postProbPercentage = postProb * 100;
        const resultMessage = totalLR >= thresholdLR ? '정밀검사가 필요합니다' : '수치 상 안전할 가능성이 높습니다';

        // Create workbook and worksheets
        const workbook = xlsx.utils.book_new();

        // Helper function to create a worksheet with a default message if data is empty
        function createWorksheet(data, sheetName) {
            if (!data || data.length === 0) {
                return xlsx.utils.json_to_sheet([{ message: `No data available for ${sheetName}` }]);
            }

            // Convert BigInt to string if present
            const processedData = data.map(item => {
                const newItem = {};
                for (const [key, value] of Object.entries(item)) {
                    if (typeof value === 'bigint') {
                        newItem[key] = value.toString();
                    } else if (value instanceof Date) {
                        newItem[key] = value.toISOString();
                    } else {
                        newItem[key] = value;
                    }
                }
                return newItem;
            });

            return xlsx.utils.json_to_sheet(processedData);
        }

        // Converts a single flat object to vertical rows [{항목, 값}, ...]
        function toVertical(obj) {
            return Object.entries(obj).map(([key, value]) => {
                let displayValue = value;
                if (typeof value === 'bigint') displayValue = value.toString();
                else if (value instanceof Date) displayValue = value.toISOString();
                return { 항목: key, 값: displayValue };
            });
        }

        // Add sheets to workbook
        const surveyInfo0 = surveyResponses[0] || {};
        xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(toVertical(surveyInfo0)), '기본 개인정보');

        // Add consent data sheet
        xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(consentData), '동의서');

        xlsx.utils.book_append_sheet(workbook, createWorksheet(surveyAnswers, 'Survey Answers'), '설문 응답 내용');
        xlsx.utils.book_append_sheet(workbook, createWorksheet(questions, 'Questions'), '설문지 질문');
        xlsx.utils.book_append_sheet(workbook, createWorksheet(questionsUpdrs, 'UPDRS Questions'), 'UPDRS-8item 질문');
        xlsx.utils.book_append_sheet(workbook, createWorksheet(answersUpdrs, 'UPDRS Answers'), 'UPDRS-8item 응답내용');
        
        // Add FFT metadata sheet if available
        if (fftMetadata && fftMetadata.length > 0) {
            xlsx.utils.book_append_sheet(workbook, createWorksheet(fftMetadata, 'FFT Metadata'), '손가락 두드리기 검사 결과');
        }

        // Create final results sheet with posterior probability
        const finalResults = toVertical({
            설문ID: surveyId,
            버전: latestVersion,
            나이: age,
            성별: surveyInfo.sex === 'M' ? '남성' : (surveyInfo.sex === 'F' ? '여성' : '기타'),
            기본확률: (priorProb * 100).toFixed(2) + '%',
            임계우도비: thresholdLR,
            총우도비: totalLR.toFixed(2),
            위험점수: postProbPercentage.toFixed(2) + '%',
            결과메시지: resultMessage,
            UPDRS점수: answersUpdrs.length > 0 ? answersUpdrs[0].actual_weight : 'N/A',
            손가락검사점수: fftMetadata.length > 0 ? fftMetadata[0].ftt_weight : 'N/A'
        });
        xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(finalResults), '최종 결과');
        
        // Convert workbook to buffer
        const excelBuffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

        return excelBuffer;
    } catch (error) {
        console.error('Error exporting survey to Excel:', error);
        throw error;
    }
}

function determineThresholdLR(age) {
    let thresholdLR, priorProb;
    
    if (age <= 54) {
        thresholdLR = 1000;
        priorProb = 0.004;
    } else if (age <= 59) {
        thresholdLR = 515;
        priorProb = 0.0075;
    } else if (age <= 64) {
        thresholdLR = 300;
        priorProb = 0.0125;
    } else if (age <= 69) {
        thresholdLR = 180;
        priorProb = 0.02;
    } else if (age <= 74) {
        thresholdLR = 155;
        priorProb = 0.025;
    } else if (age <= 79) {
        thresholdLR = 110;
        priorProb = 0.035;
    } else {
        thresholdLR = 95;
        priorProb = 0.04;
    }
    
    return { thresholdLR, priorProb };
}

module.exports = exportSurveyToExcel;